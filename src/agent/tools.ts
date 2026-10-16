import { z } from 'zod';
import type { DB } from '../db/index';
import * as repo from '../db/repo';
import type { MemoryStore, Scraper, SearchTool, ToolSpec } from '../interfaces';
import { ESTADOS, ETIQUETA_TIPO, TIPOS, type Oportunidad, type Perfil } from '../types';
import { normalizar } from '../util/texto';
import { descubrir } from './descubrimiento';
import { puntuar, type Senales } from './scoring';

// Herramientas que el LLM puede llamar. Cada una: spec (JSON Schema para el proveedor) + Zod (validar args) + ejecutar.

export type Sesion = {
  historial: { role: 'user' | 'assistant'; text: string }[];
  ultimaLista: number[]; // ids de la última lista mostrada: "la 3" = ultimaLista[2]
  ultimaRef?: number; // última oportunidad mencionada: "esa"
};

export type Ctx = { db: DB; perfil: Perfil; memoria: MemoryStore; buscador: SearchTool; scraper: Scraper; sesion: Sesion };

export type ResultadoTool = { ok: true; resumen: string; datos?: unknown } | { ok: false; error: string };

type Herramienta = {
  spec: ToolSpec;
  schema: z.ZodType;
  ejecutar(args: any, ctx: Ctx): Promise<ResultadoTool>;
};

// ---------- helpers ----------

const refProps = {
  id: { type: 'integer', description: 'ID de la oportunidad' },
  posicion: { type: 'integer', description: 'Posición (1, 2, 3…) en la última lista mostrada al usuario' },
};
const RefSchema = z.object({
  id: z.coerce.number().int().optional(),
  posicion: z.coerce.number().int().min(1).optional(),
});

function resolver(ref: z.infer<typeof RefSchema>, ctx: Ctx, obligatorio = true): Oportunidad | undefined {
  let id = ref.id;
  if (!id && ref.posicion) {
    id = ctx.sesion.ultimaLista[ref.posicion - 1];
    if (!id) throw new Error(`No hay una opción ${ref.posicion} en la última lista (tiene ${ctx.sesion.ultimaLista.length}).`);
  }
  id ??= ctx.sesion.ultimaRef;
  if (!id) {
    if (obligatorio) throw new Error('No sé a cuál oportunidad te refieres. Pide la lista y dime el número.');
    return undefined;
  }
  const op = repo.obtenerOportunidad(ctx.db, id);
  if (!op) throw new Error(`No existe la oportunidad con id ${id}.`);
  ctx.sesion.ultimaRef = op.id;
  return op;
}

// Lo que el agente sabe de mis gustos: feedback estructurado (SQLite) + memoria semántica.
async function senales(ctx: Ctx, consulta: string): Promise<Senales> {
  let recuerdos: Senales['recuerdos'] = [];
  try {
    recuerdos = await ctx.memoria.buscar(consulta, 20);
  } catch (e) {
    // Si la memoria semántica está caída, seguimos con el feedback de SQLite.
    console.warn(`[memoria] ${(e as Error).message}`);
  }
  return { feedback: repo.listarFeedback(ctx.db), recuerdos };
}

const linea = (o: Oportunidad, i?: number) =>
  `${i !== undefined ? `${i + 1}. ` : ''}[${o.puntaje ?? '?'}/100] ${o.titulo} — ${o.organizacion || 's/org'} ` +
  `(${ETIQUETA_TIPO[o.tipo]}, ${o.plazo ? `cierra ${o.plazo}` : 'sin plazo'})`;

// ---------- herramientas ----------

const listar: Herramienta = {
  spec: {
    name: 'listar_oportunidades',
    description:
      'Lista oportunidades guardadas, puntuadas según el perfil y feedback del usuario, de mayor a menor puntaje. ' +
      'Excluye descartadas y vencidas salvo que se pida un estado.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: [...TIPOS], description: 'Filtrar por tipo' },
        texto: { type: 'string', description: 'Palabra a buscar en título, organización, descripción o lugar (ej. "banca")' },
        estado: { type: 'string', enum: [...ESTADOS], description: 'Filtrar por estado' },
        limite: { type: 'integer', description: 'Máximo de resultados (por defecto 5)' },
      },
    },
  },
  schema: z.object({
    tipo: z.enum(TIPOS).optional(),
    texto: z.string().optional(),
    estado: z.enum(ESTADOS).optional(),
    limite: z.coerce.number().int().min(1).max(20).default(5),
  }),
  async ejecutar({ tipo, texto, estado, limite }, ctx) {
    let ops = repo.listarOportunidades(ctx.db, { tipo, estado });
    if (!estado) ops = ops.filter((o) => o.estado !== 'descartada');
    if (texto) {
      const t = normalizar(texto);
      ops = ops.filter((o) => normalizar(`${o.titulo} ${o.organizacion} ${o.descripcion} ${o.ubicacion}`).includes(t));
    }
    const s = await senales(ctx, `${tipo ?? ''} ${texto ?? ''} descartes y preferencias`);
    const puntuadas = ops.map((o) => {
      const { puntaje, razones } = puntuar(o, ctx.perfil, s);
      repo.guardarPuntaje(ctx.db, o.id, puntaje, razones);
      return { ...o, puntaje, razones };
    });
    const visibles = puntuadas
      .filter((o) => estado || o.razones[0] !== 'El plazo ya venció')
      .sort((a, b) => b.puntaje - a.puntaje)
      .slice(0, limite);

    ctx.sesion.ultimaLista = visibles.map((o) => o.id);
    ctx.sesion.ultimaRef = undefined;
    if (!visibles.length) return { ok: true, resumen: 'No encontré oportunidades con ese filtro.', datos: [] };
    return {
      ok: true,
      resumen: visibles.map((o, i) => `${linea(o, i)}\n   ${o.razones.slice(0, 2).join(' · ')}`).join('\n'),
      datos: visibles.map((o, i) => ({
        posicion: i + 1,
        id: o.id,
        titulo: o.titulo,
        organizacion: o.organizacion,
        tipo: o.tipo,
        plazo: o.plazo,
        ubicacion: o.ubicacion,
        estado: o.estado,
        puntaje: o.puntaje,
        razones: o.razones,
        url: o.url,
      })),
    };
  },
};

const puntuarTool: Herramienta = {
  spec: {
    name: 'puntuar_oportunidad',
    description: 'Calcula el puntaje (0–100) de una oportunidad con sus razones, según perfil y feedback.',
    parameters: { type: 'object', properties: refProps },
  },
  schema: RefSchema,
  async ejecutar(args, ctx) {
    const op = resolver(args, ctx)!;
    const { puntaje, razones } = puntuar(op, ctx.perfil, await senales(ctx, `${op.titulo} ${op.organizacion}`));
    repo.guardarPuntaje(ctx.db, op.id, puntaje, razones);
    return {
      ok: true,
      resumen: `«${op.titulo}» (${op.organizacion}): ${puntaje}/100\n- ${razones.join('\n- ')}\n${op.url}`,
      datos: { id: op.id, puntaje, razones, url: op.url, descripcion: op.descripcion, plazo: op.plazo },
    };
  },
};

const cambiarEstado: Herramienta = {
  spec: {
    name: 'cambiar_estado',
    description: 'Mueve una oportunidad a otro estado del tablero (nueva, interesa, postulada, respondida, descartada).',
    parameters: {
      type: 'object',
      properties: { ...refProps, estado: { type: 'string', enum: [...ESTADOS] } },
      required: ['estado'],
    },
  },
  schema: RefSchema.extend({ estado: z.enum(ESTADOS) }),
  async ejecutar(args, ctx) {
    const op = resolver(args, ctx)!;
    repo.cambiarEstado(ctx.db, op.id, args.estado);
    return { ok: true, resumen: `Listo: «${op.titulo}» ahora está en "${args.estado}".`, datos: { id: op.id, estado: args.estado } };
  },
};

const registrarFeedback: Herramienta = {
  spec: {
    name: 'registrar_feedback',
    description:
      'Guarda la opinión del usuario para mejorar el filtro. "descartar" también saca la oportunidad del tablero; ' +
      '"aceptar" la marca como "interesa". Sin id ni posición se guarda como preferencia general.',
    parameters: {
      type: 'object',
      properties: {
        ...refProps,
        accion: { type: 'string', enum: ['descartar', 'aceptar', 'comentario'] },
        motivo: { type: 'string', description: 'Por qué, con las palabras del usuario (ej. "no me interesa Lima Norte")' },
      },
      required: ['accion', 'motivo'],
    },
  },
  schema: RefSchema.extend({ accion: z.enum(['descartar', 'aceptar', 'comentario']), motivo: z.string().default('') }),
  async ejecutar(args, ctx) {
    const op = resolver(args, ctx, false);
    repo.insertarFeedback(ctx.db, { oportunidad_id: op?.id ?? null, accion: args.accion, motivo: args.motivo });
    if (op && args.accion === 'descartar') repo.cambiarEstado(ctx.db, op.id, 'descartada');
    if (op && args.accion === 'aceptar' && op.estado === 'nueva') repo.cambiarEstado(ctx.db, op.id, 'interesa');
    try {
      await ctx.memoria.guardar(args.motivo || `${args.accion}: ${op?.titulo ?? ''}`, {
        tipo: 'feedback',
        accion: args.accion,
        ...(op ? { oportunidad: op.titulo, organizacion: op.organizacion } : {}),
      });
    } catch (e) {
      console.warn(`[memoria] no se pudo guardar (queda en SQLite): ${(e as Error).message}`);
    }
    const sobre = op ? `«${op.titulo}»` : 'tus preferencias';
    const efecto = { descartar: 'La saqué del tablero y bajaré las parecidas.', aceptar: 'La marqué como "interesa".', comentario: '' };
    return { ok: true, resumen: `Anotado sobre ${sobre}: "${args.motivo}". ${efecto[args.accion as keyof typeof efecto]}`.trim() };
  },
};

const redactarBorrador: Herramienta = {
  spec: {
    name: 'redactar_borrador',
    description:
      'Genera y guarda un BORRADOR de postulación para una oportunidad. Nunca lo envía: el usuario lo revisa y lo envía él mismo.',
    parameters: { type: 'object', properties: refProps },
  },
  schema: RefSchema,
  async ejecutar(args, ctx) {
    const op = resolver(args, ctx)!;
    const p = ctx.perfil;
    const { razones } = puntuar(op, p);
    const encaje = razones.find((r) => r.startsWith('Encaja'))?.replace('Encaja con tus intereses: ', '') ?? 'mi área de estudio';
    const borrador = [
      `Asunto: Postulación – ${op.titulo}`,
      '',
      `Estimado equipo de ${op.organizacion || 'la organización'}:`,
      '',
      `Mi nombre es ${p.nombre}, estudiante de ${p.estudios}. Me gustaría postular a «${op.titulo}», ` +
        `ya que se alinea con mi interés en ${encaje}.`,
      p.certificaciones.length ? `Cuento con las certificaciones ${p.certificaciones.join(' y ')}.` : '',
      p.experiencia.length ? `Además, me desempeñé como ${p.experiencia[0]}.` : '',
      '',
      'Adjunto mi CV y quedo atento a sus indicaciones.',
      '',
      'Saludos cordiales,',
      p.nombre,
    ]
      .filter((l, i, a) => l !== '' || a[i - 1] !== '')
      .join('\n');
    const id = repo.insertarPostulacion(ctx.db, op.id, borrador);
    return {
      ok: true,
      resumen: `Borrador #${id} para «${op.titulo}» (no se envió nada, revísalo y envíalo tú):\n\n${borrador}\n\nPostula aquí: ${op.url}`,
      datos: { postulacion_id: id, borrador, url: op.url },
    };
  },
};

const buscarOportunidades: Herramienta = {
  spec: {
    name: 'buscar_oportunidades',
    description:
      'Busca oportunidades NUEVAS en internet (Tavily) y las guarda, sin duplicados, y las devuelve puntuadas. ' +
      'Sin consulta, escanea las fuentes configuradas (búsquedas guardadas y portales vía Apify). ' +
      'Úsala cuando el usuario pida buscar/descubrir algo nuevo; para ver lo ya guardado usa listar_oportunidades. Gasta créditos: no la repitas sin motivo.',
    parameters: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Qué buscar, en español y concreto (ej. "prácticas pre profesionales telecomunicaciones Lima")' },
      },
    },
  },
  schema: z.object({ consulta: z.string().trim().min(3).optional() }),
  async ejecutar({ consulta }, ctx) {
    const { ids, nuevas, errores } = await descubrir(ctx, consulta);
    const aviso = errores.length ? `\n⚠️ ${errores.join('\n⚠️ ')}` : '';
    const s = await senales(ctx, `${consulta ?? ''} descartes y preferencias`);
    const visibles = ids
      .map((id) => repo.obtenerOportunidad(ctx.db, id)!)
      .filter((o) => o.estado !== 'descartada')
      .map((o) => {
        const { puntaje, razones } = puntuar(o, ctx.perfil, s);
        repo.guardarPuntaje(ctx.db, o.id, puntaje, razones);
        return { ...o, puntaje, razones };
      })
      .sort((a, b) => Number(nuevas.includes(b.id)) - Number(nuevas.includes(a.id)) || b.puntaje - a.puntaje)
      .slice(0, 8);

    ctx.sesion.ultimaLista = visibles.map((o) => o.id);
    ctx.sesion.ultimaRef = undefined;
    if (!visibles.length) return { ok: true, resumen: `No encontré oportunidades vigentes${consulta ? ` para "${consulta}"` : ''}.${aviso}`, datos: [] };
    const cabecera = nuevas.length
      ? `Encontré ${nuevas.length} nueva(s) (🆕) y ${ids.length - nuevas.length} que ya tenía guardada(s):`
      : `No hay nuevas: las ${ids.length} que encontré ya estaban guardadas.`;
    return {
      ok: true,
      resumen:
        `${cabecera}\n` +
        visibles.map((o, i) => `${linea(o, i)}${nuevas.includes(o.id) ? ' 🆕' : ''}\n   ${o.razones.slice(0, 2).join(' · ')}\n   ${o.url}`).join('\n') +
        aviso,
      datos: {
        nuevas: nuevas.length,
        ya_guardadas: ids.length - nuevas.length,
        errores,
        oportunidades: visibles.map((o, i) => ({
          posicion: i + 1,
          id: o.id,
          nueva: nuevas.includes(o.id),
          titulo: o.titulo,
          organizacion: o.organizacion,
          tipo: o.tipo,
          plazo: o.plazo,
          ubicacion: o.ubicacion,
          puntaje: o.puntaje,
          razones: o.razones,
          url: o.url,
        })),
      },
    };
  },
};

const enriquecerOportunidad: Herramienta = {
  spec: {
    name: 'enriquecer_oportunidad',
    description: 'Investiga en la web una oportunidad guardada: qué es la organización, requisitos y noticias recientes. Gasta 1 crédito de búsqueda.',
    parameters: { type: 'object', properties: refProps },
  },
  schema: RefSchema,
  async ejecutar(args, ctx) {
    const op = resolver(args, ctx)!;
    const info = await ctx.buscador.enriquecer(op);
    return { ok: true, resumen: `Sobre «${op.titulo}» (${op.organizacion}):\n${info}\n${op.url}`, datos: { id: op.id, info, url: op.url } };
  },
};

export const HERRAMIENTAS: Herramienta[] = [listar, buscarOportunidades, enriquecerOportunidad, puntuarTool, cambiarEstado, registrarFeedback, redactarBorrador];

export async function ejecutarHerramienta(nombre: string, args: unknown, ctx: Ctx): Promise<ResultadoTool> {
  const h = HERRAMIENTAS.find((x) => x.spec.name === nombre);
  if (!h) return { ok: false, error: `Herramienta desconocida: ${nombre}` };
  const parsed = h.schema.safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: `Argumentos inválidos: ${z.prettifyError(parsed.error)}` };
  try {
    return await h.ejecutar(parsed.data, ctx);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
