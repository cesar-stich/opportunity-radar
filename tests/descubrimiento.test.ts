import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearAgente } from '../src/agent/agent';
import * as repo from '../src/db/repo';
import type { SearchTool } from '../src/interfaces';
import { ApifyScraper, tarjetaAOportunidad } from '../src/tools/apify';
import { resultadoAOportunidad, TavilySearch } from '../src/tools/tavily';
import type { OportunidadInput } from '../src/types';
import { detectarLugar, detectarTipo, extraerPlazo } from '../src/util/extraer';
import { hoyISO, sumarDias } from '../src/util/texto';
import { depsDePrueba } from './helpers';

const HOY = '2026-10-16';

describe('extracción heurística', () => {
  it('encuentra el plazo cerca de una palabra clave, en varios formatos', () => {
    expect(extraerPlazo('Límite de postulación: 20 de octubre de 2026', HOY)).toBe('2026-10-20');
    expect(extraerPlazo('Inscripciones del 1 de octubre al 30 de octubre', HOY)).toBe('2026-10-30');
    expect(extraerPlazo('Deadline: November 15, 2026. Apply now', HOY)).toBe('2026-11-15');
    expect(extraerPlazo('Postula hasta el 05/11/2026 en nuestra web', HOY)).toBe('2026-11-05');
    expect(extraerPlazo('Fecha límite 2026-12-01', HOY)).toBe('2026-12-01');
  });

  it('no confunde otras fechas con el plazo y avisa si ya venció', () => {
    expect(extraerPlazo('Publicado el 3 de enero de 2026. Gran oportunidad.', HOY)).toBeNull();
    expect(extraerPlazo('Convocatoria cerrada: plazo hasta el 2 de marzo de 2026', HOY)).toBe('2026-03-02');
  });

  it('detecta tipo, ubicación y modalidad', () => {
    expect(detectarTipo('Practicante de Redes', 'empresa con becas')).toBe('practica');
    expect(detectarTipo('Programa Talento', 'beca completa para estudiantes')).toBe('beca');
    expect(detectarTipo('Algo genérico')).toBe('convocatoria');
    expect(detectarLugar('Prácticas en Lima Norte, modalidad híbrida')).toEqual({ ubicacion: 'Lima Norte', modalidad: 'hibrido' });
    expect(detectarLugar('Curso 100% online')).toEqual({ ubicacion: 'Remoto', modalidad: 'remoto' });
  });
});

describe('Tavily (sin red)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('convierte un resultado de búsqueda en oportunidad y descarta las vencidas', () => {
    const op = resultadoAOportunidad(
      {
        title: 'Practicante de Redes y Telecomunicaciones - Claro Perú | Bolsa',
        url: 'https://empleos.example.pe/claro-redes',
        content: 'Buscamos estudiantes de ingeniería de telecomunicaciones en Lima. Postula hasta el 30 de octubre de 2026.',
      },
      HOY,
    );
    expect(op).toMatchObject({
      titulo: 'Practicante de Redes y Telecomunicaciones',
      organizacion: 'Claro Perú',
      tipo: 'practica',
      plazo: '2026-10-30',
      ubicacion: 'Lima',
      fuente: 'tavily',
    });
    const vencida = resultadoAOportunidad({ title: 'Beca X', url: 'https://x.pe/b', content: 'Plazo: 1 de enero de 2026' }, HOY);
    expect(vencida).toBeNull();
  });

  it('busca con search_depth basic (1 crédito) y Bearer', async () => {
    const fetchFalso = vi.fn(async () =>
      Response.json({
        results: [
          { title: 'Hackathon IA Lima 2026', url: 'https://hack.example.pe', content: 'Inscripciones hasta el 25/10/2026', raw_content: null },
        ],
        usage: { credits: 1 },
      }),
    );
    vi.stubGlobal('fetch', fetchFalso);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const ops = await new TavilySearch('tvly-test').buscar('hackathon Lima');
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tvly-test');
    expect(JSON.parse(String(init.body))).toMatchObject({ query: 'hackathon Lima', search_depth: 'basic' });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ tipo: 'hackathon', ubicacion: 'Lima' });
  });

  it('sin llave falla con un mensaje claro', async () => {
    await expect(new TavilySearch().buscar('x')).rejects.toThrow(/TAVILY_API_KEY/);
  });
});

describe('Apify (sin red)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const tarjeta = {
    titulo: 'España',
    url: 'https://www.pronabec.gob.pe/beca-espana-posgrado/',
    texto: 'España Límite de postulación: 20 de octubre de 2026 Días Horas Minutos Postulación finalizada Más información',
  };

  it('convierte una tarjeta de PRONABEC en oportunidad', () => {
    expect(tarjetaAOportunidad(tarjeta, { nombre: 'PRONABEC becas internacionales' }, HOY)).toMatchObject({
      titulo: 'Beca espana posgrado (España)',
      organizacion: 'PRONABEC becas internacionales',
      tipo: 'beca',
      plazo: '2026-10-20',
      fuente: 'apify',
    });
  });

  it('llama al actor cheerio-scraper y aplana las tarjetas', async () => {
    const fetchFalso = vi.fn(async () => Response.json([{ pagina: 'https://www.pronabec.gob.pe/x', items: [tarjeta] }], { status: 201 }));
    vi.stubGlobal('fetch', fetchFalso);
    const ops = await new ApifyScraper('apify_api_test').scrapear({ nombre: 'PRONABEC', url: 'https://www.pronabec.gob.pe/x' });
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/api\.apify\.com\/v2\/actors\/apify~cheerio-scraper\/run-sync-get-dataset-items/);
    expect(JSON.parse(String(init.body))).toMatchObject({ startUrls: [{ url: 'https://www.pronabec.gob.pe/x' }], maxPagesPerCrawl: 1 });
    expect(ops.map((o) => o.plazo)).toEqual(['2026-10-20']);
  });
});

// Buscador falso con resultados fijos (como si vinieran de Tavily).
function buscadorFijo(): SearchTool & { consultas: string[] } {
  const en = (d: number) => sumarDias(hoyISO(), d);
  const resultados: OportunidadInput[] = [
    { titulo: 'Prácticas en Redes 5G', organizacion: 'Telco Real', tipo: 'practica', descripcion: 'Telecomunicaciones y fibra óptica', url: 'https://telco.example.pe/practicas', ubicacion: 'Lima', modalidad: 'presencial', plazo: en(10), fuente: 'tavily' },
    { titulo: 'Practicante NOC', organizacion: 'Red Andina', tipo: 'practica', descripcion: 'Monitoreo de redes', url: 'https://redandina.example.pe/noc', ubicacion: 'Lima', modalidad: 'hibrido', plazo: null, fuente: 'tavily' },
  ];
  const consultas: string[] = [];
  return {
    nombre: 'fijo',
    consultas,
    async buscar(c) {
      consultas.push(c);
      return resultados;
    },
    async enriquecer(op) {
      return `${op.organizacion} es un operador; piden estar en 8vo ciclo.`;
    },
  };
}

describe('agente: buscar_oportunidades', () => {
  it('"busca prácticas de telecomunicaciones en Lima" guarda, puntúa y no duplica al repetir', async () => {
    const buscador = buscadorFijo();
    const deps = depsDePrueba({ buscador });
    const agente = crearAgente(deps);
    const antes = repo.listarOportunidades(deps.db).length;

    const r1 = await agente.responder('cesar', 'busca prácticas de telecomunicaciones en Lima');
    expect(r1.herramientas).toEqual(['buscar_oportunidades']);
    expect(buscador.consultas).toEqual(['prácticas de telecomunicaciones en Lima']);
    expect(r1.respuesta).toMatch(/Encontré 2 nueva/);
    expect(r1.respuesta).toMatch(/🆕/);
    expect(r1.respuesta).toMatch(/https:\/\/telco\.example\.pe\/practicas/);
    expect(repo.listarOportunidades(deps.db)).toHaveLength(antes + 2);

    const r2 = await agente.responder('cesar', 'busca prácticas de telecomunicaciones en Lima');
    expect(r2.respuesta).toMatch(/No hay nuevas/);
    expect(repo.listarOportunidades(deps.db)).toHaveLength(antes + 2);

    // La lista de la búsqueda sirve para "investiga la 1".
    const r3 = await agente.responder('cesar', 'investiga la 1');
    expect(r3.herramientas).toEqual(['enriquecer_oportunidad']);
    expect(r3.respuesta).toMatch(/8vo ciclo/);
  });

  it('"escanea las fuentes" recorre las fuentes activas y sigue si una falla', async () => {
    const deps = depsDePrueba({
      scraper: { nombre: 'roto', scrapear: async () => Promise.reject(new Error('portal caído')) },
    });
    const { respuesta, herramientas } = await crearAgente(deps).responder('cesar', 'escanea las fuentes');
    expect(herramientas).toEqual(['buscar_oportunidades']);
    expect(respuesta).toMatch(/Resultado simulado/); // MockSearch por cada fuente de Tavily
    expect(respuesta).toMatch(/portal caído/);
    expect(repo.listarFuentes(deps.db, true).map((f) => f.tipo)).toContain('apify');
  });
});
