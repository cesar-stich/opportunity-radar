import type { Scraper } from '../interfaces';
import type { OportunidadInput } from '../types';
import { detectarLugar, detectarTipo, extraerPlazo, recortar, tituloDesdeUrl } from '../util/extraer';
import { hoyISO, sumarDias } from '../util/texto';

// Apify = scraping de portales de convocatorias que no tienen API (lista en la tabla `fuentes`).

// Mock: devuelve una oferta ficticia por fuente.
export class MockScraper implements Scraper {
  nombre = 'mock';
  async scrapear(fuente: { nombre: string; url: string }): Promise<OportunidadInput[]> {
    return [
      {
        titulo: `Practicante de Soporte TI (simulado desde ${fuente.nombre})`,
        organizacion: 'Portal Mock',
        tipo: 'practica',
        descripcion: 'Oferta de prueba obtenida por el scraper mock: soporte de redes y cloud.',
        url: `https://example.com/apify/${encodeURIComponent(fuente.nombre)}`,
        ubicacion: 'Lima',
        modalidad: 'hibrido',
        plazo: sumarDias(hoyISO(), 10),
        fuente: 'apify-mock',
      },
    ];
  }
}

// ---------- Real: actor público apify/cheerio-scraper (https://docs.apify.com, verificado el 2026-10-16) ----------
// Se usa un actor existente y genérico (gratis; solo se paga el uso de la plataforma, cubierto por los US$5/mes
// del plan Free). Corre en modo síncrono con `run-sync-get-dataset-items` y `Authorization: Bearer <token>`.
// Una sola página por fuente, sin seguir enlaces: carga mínima para el portal (respeta sus términos).

const ACTOR = 'apify~cheerio-scraper';
const URL_API = `https://api.apify.com/v2/actors/${ACTOR}/run-sync-get-dataset-items?timeout=120&memory=512`;

// Corre DENTRO de Apify (Cheerio). Genérica, reconoce dos formatos comunes en portales del Estado:
//  1. Tarjetas: un título con enlace (h1–h4 > a) cuyo bloque cercano menciona un plazo ("límite", "cierre"…). Ej. PRONABEC.
//  2. Tablas: cada fila con enlace; el título es la celda más larga y las demás van entre paréntesis
//     (así "Practicante - DFI (028-2026)" y "(029-2026)" no se deduplican como si fueran la misma). Ej. OSIPTEL.
// Devuelve un solo registro con todas las tarjetas.
const PAGE_FUNCTION = `async function pageFunction({ $, request }) {
  const CLAVE = /l[ií]mite|plazo|cierre|cierra|hasta|fecha|deadline|postula|inscrip/i;
  const limpiar = (s) => s.replace(/\\s+/g, ' ').trim();
  const base = request.loadedUrl || request.url;
  const vistos = new Set();
  const items = [];
  const agregar = (titulo, href, texto) => {
    const url = new URL(href, base).href;
    if (!titulo || vistos.has(url)) return;
    vistos.add(url);
    items.push({ titulo, url, texto });
  };
  $('h1 a[href], h2 a[href], h3 a[href], h4 a[href]').each((_, a) => {
    let bloque = $(a).closest('h1,h2,h3,h4').parent();
    for (let i = 0; i < 3 && !CLAVE.test(bloque.text()); i++) bloque = bloque.parent();
    const texto = limpiar(bloque.text());
    if (CLAVE.test(texto) && texto.length <= 1500) agregar(limpiar($(a).text()), $(a).attr('href'), texto);
  });
  $('tr').each((_, tr) => {
    const a = $(tr).find('a[href]').first();
    const celdas = $(tr).find('td').map((_, td) => limpiar($(td).text())).get();
    if (!a.length || celdas.length < 2) return;
    const [principal, ...otras] = celdas.filter((c) => c && c !== limpiar(a.text())).sort((x, y) => y.length - x.length);
    agregar(otras.length ? principal + ' (' + otras.join(', ') + ')' : principal, a.attr('href'), celdas.join(' · '));
  });
  return { pagina: request.url, items };
}`;

export type TarjetaScrapeada = { titulo: string; url: string; texto: string };

// Tarjeta de un portal → oportunidad. null si ya venció.
export function tarjetaAOportunidad(t: TarjetaScrapeada, fuente: { nombre: string }, hoy = hoyISO()): OportunidadInput | null {
  const plazo = extraerPlazo(t.texto, hoy);
  if (plazo && plazo < hoy) return null;
  // Si el título es muy corto (p. ej. solo "España"), el slug de la URL suele decir más ("Beca espana posgrado").
  const slug = tituloDesdeUrl(t.url);
  const titulo = t.titulo.split(' ').length <= 2 && slug ? `${slug} (${t.titulo})` : t.titulo;
  return {
    titulo: recortar(titulo, 140),
    organizacion: fuente.nombre,
    tipo: detectarTipo(titulo, t.texto),
    descripcion: recortar(t.texto, 400),
    url: t.url,
    ...detectarLugar(t.texto),
    plazo,
    fuente: 'apify',
  };
}

export class ApifyScraper implements Scraper {
  nombre = 'apify';
  constructor(private token?: string) {}

  async scrapear(fuente: { nombre: string; url: string }): Promise<OportunidadInput[]> {
    if (!this.token) throw new Error('APIFY_MODE=real requiere APIFY_TOKEN en .env');
    const res = await fetch(URL_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({
        startUrls: [{ url: fuente.url }],
        pageFunction: PAGE_FUNCTION,
        maxPagesPerCrawl: 1,
        maxCrawlingDepth: 0,
        linkSelector: '',
        proxyConfiguration: { useApifyProxy: true }, // el actor lo exige; el plan Free incluye Apify Proxy
      }),
      signal: AbortSignal.timeout(150_000),
    });
    if (!res.ok) {
      const cuerpo = await res.text();
      // Primera vez: Apify pide aprobar (una sola vez, en la consola) que el actor corra con permisos completos.
      const aprobar = cuerpo.match(/"approvalUrl":\s*"([^"]+)"/)?.[1];
      if (aprobar) throw new Error(`Apify: aprueba los permisos del actor una vez en ${aprobar}`);
      throw new Error(`Apify ${res.status}: ${cuerpo.slice(0, 200)}`);
    }
    const registros = (await res.json()) as { items?: TarjetaScrapeada[] }[];
    const hoy = hoyISO();
    return registros
      .flatMap((r) => r.items ?? [])
      .map((t) => tarjetaAOportunidad(t, fuente, hoy))
      .filter((o): o is OportunidadInput => o !== null);
  }
}
