import type { SearchTool } from '../interfaces';
import type { OportunidadInput } from '../types';
import { detectarLugar, detectarTipo, dominio, extraerPlazo, recortar } from '../util/extraer';
import { hoyISO, sumarDias } from '../util/texto';

// Tavily = búsqueda abierta: descubrir oportunidades nuevas y enriquecer cada una.

// Mock: devuelve un hallazgo ficticio por consulta (URL en example.com).
export class MockSearch implements SearchTool {
  nombre = 'mock';
  async buscar(consulta: string): Promise<OportunidadInput[]> {
    const slug = consulta.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    return [
      {
        titulo: `Resultado simulado: ${consulta}`,
        organizacion: 'Buscador Mock',
        tipo: 'convocatoria',
        descripcion: `Oportunidad de prueba encontrada para "${consulta}".`,
        url: `https://example.com/tavily/${slug}`,
        ubicacion: 'Lima',
        modalidad: 'remoto',
        plazo: sumarDias(hoyISO(), 20),
        fuente: 'tavily-mock',
      },
    ];
  }
  async enriquecer(op: { titulo: string; organizacion: string }) {
    return `(mock) ${op.organizacion} es una organización ficticia; no hay noticias recientes sobre "${op.titulo}".`;
  }
}

// ---------- Real: API REST de Tavily (https://docs.tavily.com, verificada el 2026-10-16) ----------
// POST https://api.tavily.com/search con `Authorization: Bearer tvly-…`.
// Plan gratis: 1,000 créditos/mes. search_depth "basic" = 1 crédito ("advanced" = 2), así que siempre basic.

export type ResultadoTavily = { title: string; url: string; content: string; raw_content?: string | null; score?: number };
type RespuestaTavily = { results: ResultadoTavily[]; answer?: string; usage?: { credits: number } };

const URL_API = 'https://api.tavily.com/search';
const MAX_RESULTADOS = 8;

// Bolsas de empleo y redes sociales: devuelven páginas de búsqueda o posts sin enlace estable, no ofertas concretas.
// Sin ellas, Tavily trae las páginas de convocatorias de las propias instituciones (MTPE, SERVIR, OSIPTEL…).
const DOMINIOS_EXCLUIDOS = [
  'indeed.com', 'linkedin.com', 'computrabajo.com', 'bumeran.com.pe', 'opcionempleo.com.pe', 'glassdoor.com',
  'jooble.org', 'talent.com', 'trabajos.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'youtube.com',
];

// "Practicante de Redes - Claro Perú | Computrabajo" → título "Practicante de Redes", organización "Claro Perú".
function partirTitulo(titulo: string, url: string): { titulo: string; organizacion: string } {
  const partes = titulo.replace(/\s*(\.\.\.|…)\s*$/, '').split(/\s+[|–—-]\s+/).map((s) => s.trim()).filter(Boolean);
  const principal = partes[0]?.length >= 8 ? partes[0] : titulo.trim();
  const org = partes.length > 1 && partes[1].length <= 50 ? partes[1] : dominio(url);
  return { titulo: principal, organizacion: org };
}

// Convierte un resultado de búsqueda (texto libre) en oportunidad. null si ya venció.
export function resultadoAOportunidad(r: ResultadoTavily, hoy = hoyISO()): OportunidadInput | null {
  const { titulo, organizacion } = partirTitulo(r.title, r.url);
  const resumen = r.content ?? '';
  // El plazo se busca primero en el resumen y luego en el contenido de la página, pero solo si ahí hay 1–2 fechas:
  // un listado con muchas convocatorias no tiene "un" plazo.
  const plazo = extraerPlazo(resumen, hoy) ?? extraerPlazo((r.raw_content ?? '').slice(0, 20_000), hoy, 2);
  if (plazo && plazo < hoy) return null;
  return {
    titulo: recortar(titulo, 140),
    organizacion,
    tipo: detectarTipo(titulo, resumen),
    descripcion: recortar(resumen, 400),
    url: r.url,
    ...detectarLugar(`${r.title} ${resumen}`),
    plazo,
    fuente: 'tavily',
  };
}

export class TavilySearch implements SearchTool {
  nombre = 'tavily';
  constructor(private apiKey?: string) {}

  private async llamar(cuerpo: Record<string, unknown>): Promise<RespuestaTavily> {
    if (!this.apiKey) throw new Error('TAVILY_MODE=real requiere TAVILY_API_KEY en .env');
    const res = await fetch(URL_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ search_depth: 'basic', include_usage: true, ...cuerpo }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 432) throw new Error('Tavily: se acabaron los créditos gratis de este mes (432)');
    if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const datos = (await res.json()) as RespuestaTavily;
    if (datos.usage) console.info(`[tavily] créditos usados: ${datos.usage.credits}`);
    return datos;
  }

  async buscar(consulta: string): Promise<OportunidadInput[]> {
    const { results } = await this.llamar({
      query: consulta,
      max_results: MAX_RESULTADOS,
      country: 'peru', // prioriza resultados de Perú (solo vale con topic "general")
      exclude_domains: DOMINIOS_EXCLUIDOS,
      include_raw_content: 'markdown', // para hallar el plazo si no sale en el resumen; sigue costando 1 crédito (probado)
    });
    const hoy = hoyISO();
    return results.map((r) => resultadoAOportunidad(r, hoy)).filter((o): o is OportunidadInput => o !== null);
  }

  // Resumen corto (empresa, requisitos, noticias) con la respuesta generada por Tavily: 1 crédito, sin gastar nuestro LLM.
  async enriquecer(op: { titulo: string; organizacion: string; url: string }): Promise<string> {
    const { answer, results } = await this.llamar({
      query: `${op.titulo} ${op.organizacion}: requisitos, cómo postular y noticias recientes`,
      max_results: 3,
      include_answer: 'basic',
    });
    const fuentes = results.slice(0, 2).map((r) => r.url);
    const cuerpo = answer?.trim() || results.map((r) => recortar(r.content, 200)).join('\n') || 'No encontré información adicional.';
    return `${recortar(cuerpo, 700)}${fuentes.length ? `\nFuentes: ${fuentes.join(' · ')}` : ''}`;
  }
}
