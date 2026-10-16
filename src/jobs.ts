import type { Agente } from './agent/agent';
import { descubrir } from './agent/descubrimiento';
import { puntuar } from './agent/scoring';
import { linea, senales } from './agent/tools';
import * as repo from './db/repo';
import type { Deps } from './deps';
import { hoyISO, sumarDias } from './util/texto';

// Trabajos programados. n8n solo los dispara (POST /jobs/*); aquí vive la lógica.
// Regla de oro: el agente solo avisa lo que vale la pena (puntaje >= NOTIFY_MIN_SCORE) y nunca repite un aviso.

const MAX_EN_AVISO = 5;
const DIAS_RECORDATORIO = 3;

export type ResultadoJob = { ok: boolean; avisados: number; detalle: string; errores?: string[] };

// Los avisos van al dueño: el primer ID de ALLOWED_SENDERS.
function destinatario(deps: Deps): string | undefined {
  return deps.env.ALLOWED_SENDERS[0];
}

const sinDestino = (): ResultadoJob => ({
  ok: false,
  avisados: 0,
  detalle: 'No hay a quién avisar: pon tu ID en ALLOWED_SENDERS (escríbele al bot y te lo dice).',
});

// Puntúa con el perfil, el feedback y la memoria, y guarda el puntaje.
async function puntuarTodas(deps: Deps, ids: number[]) {
  const s = await senales(deps, 'descartes y preferencias');
  return ids
    .map((id) => repo.obtenerOportunidad(deps.db, id)!)
    .map((o) => {
      const { puntaje, razones } = puntuar(o, deps.perfil, s);
      repo.guardarPuntaje(deps.db, o.id, puntaje, razones);
      return { ...o, puntaje, razones };
    });
}

function detalleAviso(o: { puntaje: number | null; razones: string[]; url: string }) {
  return `   ${o.razones.slice(0, 2).join(' · ')}\n   ${o.url}`;
}

// Escaneo diario: busca en las fuentes activas y avisa SOLO las nuevas que superan el umbral.
export async function escanear(deps: Deps, agente: Agente, hoy = hoyISO()): Promise<ResultadoJob> {
  const para = destinatario(deps);
  if (!para) return sinDestino();
  const { nuevas, errores } = await descubrir(deps);
  const buenas = (await puntuarTodas(deps, nuevas))
    .filter((o) => o.estado === 'nueva' && (o.puntaje ?? 0) >= deps.env.NOTIFY_MIN_SCORE && !(o.plazo && o.plazo < hoy))
    .filter((o) => !repo.yaAvisada(deps.db, o.id, 'nueva'))
    .sort((a, b) => b.puntaje! - a.puntaje!)
    .slice(0, MAX_EN_AVISO);

  const detalle = `${nuevas.length} nuevas, ${buenas.length} sobre ${deps.env.NOTIFY_MIN_SCORE} puntos`;
  if (buenas.length) {
    const texto =
      `📡 ${buenas.length === 1 ? 'Encontré una oportunidad' : `Encontré ${buenas.length} oportunidades`} que vale(n) la pena:\n\n` +
      buenas.map((o, i) => `${linea(o, i)}\n${detalleAviso(o)}`).join('\n\n') +
      '\n\nDime "me interesa la 1", "descarta la 2" o "prepárame el mensaje para la 1".';
    await deps.canal.enviarTexto(para, texto);
    agente.establecerLista(para, buenas.map((o) => o.id));
    for (const o of buenas) repo.marcarAvisada(deps.db, o.id, 'nueva');
  }
  return { ok: true, avisados: buenas.length, detalle, ...(errores.length ? { errores } : {}) };
}

// Recordatorio diario: lo que te interesa (o puntúa alto) y cierra en <= 3 días, una sola vez por oportunidad.
export async function recordarPlazos(deps: Deps, agente: Agente, hoy = hoyISO()): Promise<ResultadoJob> {
  const para = destinatario(deps);
  if (!para) return sinDestino();
  const candidatas = repo.oportunidadesConPlazo(deps.db, hoy, sumarDias(hoy, DIAS_RECORDATORIO));
  const importantes = (await puntuarTodas(deps, candidatas.map((o) => o.id)))
    .filter((o) => o.estado === 'interesa' || (o.estado === 'nueva' && (o.puntaje ?? 0) >= deps.env.NOTIFY_MIN_SCORE))
    .filter((o) => !repo.yaAvisada(deps.db, o.id, 'plazo'));

  if (importantes.length) {
    const texto =
      `⏰ Cierra pronto:\n\n` +
      importantes.map((o, i) => `${linea(o, i)}\n${detalleAviso(o)}`).join('\n\n') +
      '\n\nRecuerda: las postulaciones las envías tú; si quieres, te preparo el borrador.';
    await deps.canal.enviarTexto(para, texto);
    agente.establecerLista(para, importantes.map((o) => o.id));
    for (const o of importantes) repo.marcarAvisada(deps.db, o.id, 'plazo');
  }
  return { ok: true, avisados: importantes.length, detalle: `${candidatas.length} cierran en ${DIAS_RECORDATORIO} días, ${importantes.length} importantes` };
}

// Resumen de la semana: siempre se manda (aunque sea para decir que no hay novedades).
export async function resumenSemanal(deps: Deps, agente: Agente, hoy = hoyISO()): Promise<ResultadoJob> {
  const para = destinatario(deps);
  if (!para) return sinDestino();
  const vigentes = (await puntuarTodas(deps, repo.listarOportunidades(deps.db).filter((o) => o.estado === 'nueva' || o.estado === 'interesa').map((o) => o.id)))
    .filter((o) => !(o.plazo && o.plazo < hoy))
    .sort((a, b) => b.puntaje! - a.puntaje!);
  const top = vigentes.slice(0, MAX_EN_AVISO);
  const cierran = repo.oportunidadesConPlazo(deps.db, hoy, sumarDias(hoy, 7)).length;
  const e = repo.estadisticas(deps.db, hoy);

  const texto = top.length
    ? `🗓️ Resumen de la semana: ${vigentes.length} oportunidades vigentes, ${cierran} cierran en 7 días, ${e.postulaciones} borradores.\n\n` +
      `Las mejores:\n\n${top.map((o, i) => `${linea(o, i)}\n${detalleAviso(o)}`).join('\n\n')}`
    : '🗓️ Resumen de la semana: no tengo oportunidades vigentes. Pídeme que busque algo nuevo.';
  await deps.canal.enviarTexto(para, texto);
  if (top.length) agente.establecerLista(para, top.map((o) => o.id));
  return { ok: true, avisados: top.length, detalle: `${vigentes.length} vigentes, ${cierran} cierran en 7 días` };
}

export const JOBS = { escanear, 'recordar-plazos': recordarPlazos, 'resumen-semanal': resumenSemanal } as const;
export type NombreJob = keyof typeof JOBS;
