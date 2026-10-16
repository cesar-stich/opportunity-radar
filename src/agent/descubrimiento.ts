import type { DB } from '../db/index';
import * as repo from '../db/repo';
import type { Scraper, SearchTool } from '../interfaces';
import type { OportunidadInput } from '../types';

// Descubrimiento: trae oportunidades de Tavily (búsqueda abierta) y Apify (portales), las guarda en SQLite
// y deduplica (insertarOportunidad ya lo hace por URL y por título + organización).
// Lo usan la herramienta `buscar_oportunidades`, `pnpm escanear` y, en la Fase 6, `/jobs/escanear`.

export type DescubrirDeps = { db: DB; buscador: SearchTool; scraper: Scraper };
export type ResultadoDescubrir = { ids: number[]; nuevas: number[]; errores: string[] };

export async function descubrir(deps: DescubrirDeps, consulta?: string): Promise<ResultadoDescubrir> {
  const hallazgos: OportunidadInput[] = [];
  const errores: string[] = [];

  // Con consulta: búsqueda abierta en Tavily. Sin consulta: escanea las fuentes activas de la tabla `fuentes`.
  const tareas = consulta
    ? [{ nombre: `Tavily "${consulta}"`, correr: () => deps.buscador.buscar(consulta) }]
    : repo.listarFuentes(deps.db, true).flatMap((f) => {
        if (f.tipo === 'tavily' && f.consulta) return [{ nombre: f.nombre, correr: () => deps.buscador.buscar(f.consulta!) }];
        if (f.tipo === 'apify' && f.url) return [{ nombre: f.nombre, correr: () => deps.scraper.scrapear({ nombre: f.nombre, url: f.url! }) }];
        return [];
      });

  // Una fuente caída no detiene a las demás.
  for (const t of tareas) {
    try {
      hallazgos.push(...(await t.correr()));
    } catch (e) {
      errores.push(`${t.nombre}: ${(e as Error).message}`);
    }
  }

  const ids: number[] = [];
  const nuevas: number[] = [];
  for (const h of hallazgos) {
    try {
      const { id, nueva } = repo.insertarOportunidad(deps.db, h);
      if (!ids.includes(id)) ids.push(id);
      if (nueva) nuevas.push(id);
    } catch (e) {
      errores.push(`No se pudo guardar "${h.titulo}": ${(e as Error).message.split('\n')[0]}`);
    }
  }
  return { ids, nuevas, errores };
}
