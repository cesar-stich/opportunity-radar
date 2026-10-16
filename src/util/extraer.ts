import type { Tipo } from '../types';
import { contienePalabra, normalizar } from './texto';

// Heurísticas para convertir texto libre (resultados de Tavily, tarjetas scrapeadas por Apify) en campos
// estructurados. Son deterministas a propósito: no gastan tokens, no dependen de que el LLM esté disponible
// y se pueden testear sin red. Si algo no se detecta con seguridad, se deja vacío (null) en vez de inventarlo.

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};
const MES = Object.keys(MESES).join('|');

// Palabras que anuncian un plazo: solo miramos fechas cerca de ellas (así no confundimos la fecha de publicación).
const CLAVE_PLAZO =
  /plazo|cierre|cierra|vence|hasta|fecha limite|limite|deadline|apply by|closing date|closes|postulaciones|postula|inscripciones|inscripcion/g;

const PATRONES_FECHA: { re: RegExp; partes(m: RegExpExecArray): [number | undefined, number, number] }[] = [
  // 30 de octubre (de 2026)
  { re: new RegExp(`(\\d{1,2})\\s+de\\s+(${MES})(?:\\s+(?:de|del)\\s+(\\d{4}))?`, 'g'), partes: (m) => [num(m[3]), MESES[m[2]], Number(m[1])] },
  // October 30, 2026
  { re: new RegExp(`\\b(${MES})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'g'), partes: (m) => [num(m[3]), MESES[m[1]], Number(m[2])] },
  // 30 October 2026
  { re: new RegExp(`(\\d{1,2})\\s+(${MES})\\s+(\\d{4})`, 'g'), partes: (m) => [num(m[3]), MESES[m[2]], Number(m[1])] },
  // 30/10/2026 (formato peruano: día/mes)
  { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g, partes: (m) => [anio4(m[3]), Number(m[2]), Number(m[1])] },
  // 2026-10-30
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, partes: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
];

const num = (s?: string) => (s ? Number(s) : undefined);
const anio4 = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

function aISO(anio: number, mes: number, dia: number): string | null {
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d.toISOString().slice(0, 10);
}

type Hallazgo = { pos: number; fin: number; iso: string };

function fechasEn(ventana: string, anioPorDefecto: number): Hallazgo[] {
  const out: Hallazgo[] = [];
  for (const { re, partes } of PATRONES_FECHA) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(ventana)); ) {
      const [a, mes, dia] = partes(m);
      const iso = aISO(a ?? anioPorDefecto, mes, dia);
      if (iso && !out.some((h) => m!.index < h.fin && h.pos < m!.index + m![0].length)) out.push({ pos: m.index, fin: m.index + m[0].length, iso });
    }
  }
  return out.sort((x, y) => x.pos - y.pos);
}

// Plazo (YYYY-MM-DD) que aparece cerca de una palabra clave. Si hay varios, el más cercano que siga vigente;
// si todos vencieron, el último (así quien llama sabe que ya cerró). null si no hay ninguno claro.
// `maxCandidatos`: si hay más fechas distintas que eso, probablemente es un listado de muchas ofertas → null.
export function extraerPlazo(texto: string, hoy: string, maxCandidatos = Infinity): string | null {
  const t = normalizar(texto);
  const anio = Number(hoy.slice(0, 4));
  const candidatos = new Set<string>();
  CLAVE_PLAZO.lastIndex = 0;
  for (let m; (m = CLAVE_PLAZO.exec(t)); ) {
    const ventana = t.slice(m.index, m.index + 90);
    const fechas = fechasEn(ventana, anio);
    if (!fechas.length) continue;
    // Rango "del 1 de octubre al 30 de octubre": el plazo es el final del rango.
    const [a, b] = fechas;
    const esRango = b && /^\s*(al|hasta( el)?|a|-|–)\s*$/.test(ventana.slice(a.fin, b.pos));
    candidatos.add(esRango ? b.iso : a.iso);
  }
  const lista = [...candidatos].sort();
  if (lista.length > maxCandidatos) return null;
  return lista.find((f) => f >= hoy) ?? lista.at(-1) ?? null;
}

// Tipo según palabras clave: primero en el título (más confiable), luego en el resto del texto.
const REGLAS_TIPO: [Tipo, RegExp][] = [
  ['hackathon', /hackat|ideathon|datathon/],
  ['practica', /practica|practicante|pasantia|internship|\bintern\b|trainee/],
  ['beca', /\bbecas?\b|scholarship|fellowship/],
  ['curso', /\bcursos?\b|bootcamp|diplomado|\btaller|\bcourse/],
  ['convocatoria', /convocatoria|concurso|premio|reto\b|challenge/],
];

export function detectarTipo(titulo: string, resto = ''): Tipo {
  for (const texto of [normalizar(titulo), normalizar(resto)]) {
    const regla = REGLAS_TIPO.find(([, re]) => re.test(texto));
    if (regla) return regla[0];
  }
  return 'convocatoria';
}

const CIUDADES = ['lima norte', 'lima sur', 'lima este', 'lima', 'arequipa', 'cusco', 'trujillo', 'piura', 'chiclayo', 'huancayo', 'iquitos', 'tacna', 'puno', 'cajamarca', 'ayacucho', 'chimbote', 'huanuco'];

const capitalizar = (s: string) => s.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());

// Ubicación y modalidad. Solo con texto "cercano" (título y resumen): el pie de página de un sitio limeño
// diría "Lima" en todas las ofertas.
export function detectarLugar(texto: string): { ubicacion: string; modalidad: 'presencial' | 'remoto' | 'hibrido' } {
  const t = normalizar(texto);
  const modalidad = /hibrid|hybrid/.test(t) ? 'hibrido' : /remot|virtual|online|a distancia|teletrabajo/.test(t) ? 'remoto' : 'presencial';
  const ciudad = CIUDADES.find((c) => contienePalabra(t, c));
  return { ubicacion: ciudad ? capitalizar(ciudad) : modalidad === 'remoto' ? 'Remoto' : '', modalidad };
}

// "https://www.pronabec.gob.pe/beca-espana-posgrado/" → "Beca espana posgrado"
export function tituloDesdeUrl(url: string): string {
  const seg = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '';
  const t = decodeURIComponent(seg).replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

export const dominio = (url: string) => new URL(url).hostname.replace(/^www\./, '');

export const recortar = (s: string, max: number) => {
  const limpio = s.replace(/\s+/g, ' ').trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio;
};
