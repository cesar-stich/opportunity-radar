import { descubrir } from './agent/descubrimiento';
import { leerEnv } from './config';
import * as repo from './db/repo';
import { crearDeps } from './deps';

// CLI de descubrimiento (lo mismo que hará n8n en la Fase 6, pero a mano):
//   pnpm escanear                 → recorre las fuentes activas
//   pnpm escanear "becas cloud"   → búsqueda puntual en Tavily
//   pnpm fuentes                  → lista las fuentes
//   pnpm fuentes activar 1 2      → activa (o `desactivar`) fuentes por id

const deps = crearDeps(leerEnv());
const [cmd, ...resto] = process.argv.slice(2);

if (cmd === 'fuentes') {
  const [accion, ...ids] = resto;
  if (accion === 'activar' || accion === 'desactivar') for (const id of ids) repo.activarFuente(deps.db, Number(id), accion === 'activar');
  for (const f of repo.listarFuentes(deps.db))
    console.log(`${f.id}. [${f.activa ? 'activa' : 'inactiva'}] ${f.nombre} (${f.tipo}) → ${f.consulta ?? f.url}`);
} else {
  const consulta = [cmd, ...resto].filter(Boolean).join(' ') || undefined;
  console.log(`Buscador: ${deps.buscador.nombre} · Scraper: ${deps.scraper.nombre} · ${consulta ? `consulta "${consulta}"` : 'fuentes activas'}`);
  const { ids, nuevas, errores } = await descubrir(deps, consulta);
  for (const id of ids) {
    const o = repo.obtenerOportunidad(deps.db, id)!;
    console.log(`${nuevas.includes(id) ? '🆕' : '  '} #${o.id} [${o.tipo}] ${o.titulo} — ${o.organizacion} · ${o.plazo ?? 'sin plazo'} · ${o.url}`);
  }
  console.log(`\n${nuevas.length} nuevas, ${ids.length - nuevas.length} ya guardadas.`);
  for (const e of errores) console.warn(`⚠️ ${e}`);
}
