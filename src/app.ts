import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { crearAgente } from './agent/agent';
import { puntuar } from './agent/scoring';
import * as repo from './db/repo';
import type { Deps } from './deps';
import { FirmaInvalida } from './channels/zavu';
import { JOBS, type NombreJob } from './jobs';
import { leerEntradaMatch } from './match';
import { crearMensajeria } from './mensajeria';
import { tokenValido } from './util/token';
import { ESTADOS, TIPOS } from './types';

// Servidor del agente: el cerebro vive aquí. Zavu solo transporta, n8n solo dispara, Maritime solo aloja.

const AskBody = z.object({ text: z.string().min(1), usuario: z.string().default('local') });
const FiltroApi = z.object({ estado: z.enum(ESTADOS).optional(), tipo: z.enum(TIPOS).optional() });

async function leerJson<T extends z.ZodType>(c: Context, schema: T) {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success
    ? ({ ok: true, data: parsed.data } as const)
    : ({ ok: false, res: c.json({ error: z.prettifyError(parsed.error) }, 400) } as const);
}

const ChatBody = z.object({ message: z.string().min(1), source: z.string().optional() });

export function crearApp(deps: Deps) {
  const app = new Hono();
  const agente = crearAgente(deps);
  const mensajeria = crearMensajeria({ canal: deps.canal, agente, permitidos: deps.env.ALLOWED_SENDERS, voz: deps.voz, responderEnVoz: deps.env.REPLY_AS_VOICE });

  app.get('/health', (c) =>
    c.json({
      ok: true,
      llm: deps.llm.nombre,
      memoria: deps.memoria.nombre,
      canal: deps.canal.nombre,
      voz: deps.voz.nombre,
      buscador: deps.buscador.nombre,
      scraper: deps.scraper.nombre,
    }),
  );

  // /ask, /chat y /api/* son privados. En local (sin API_TOKEN) quedan abiertos; en producción sin token quedan cerrados.
  // El panel web usa PANEL_TOKEN, que solo vale para leer (GET) /api/*.
  const privado = async (c: Context, next: () => Promise<void>) => {
    const { API_TOKEN, PANEL_TOKEN, NODE_ENV } = deps.env;
    if (!API_TOKEN && !PANEL_TOKEN && NODE_ENV !== 'production') return next();
    const auth = c.req.header('authorization');
    if (tokenValido(auth, API_TOKEN)) return next();
    const soloLectura = c.req.method === 'GET' && c.req.path.startsWith('/api/');
    if (soloLectura && tokenValido(auth, PANEL_TOKEN)) return next();
    if (!API_TOKEN && NODE_ENV === 'production') return c.json({ error: 'API_TOKEN no configurado' }, 401);
    return c.json({ error: 'No autorizado' }, 401);
  };
  app.use('/ask', privado);
  app.use('/chat', privado);

  // Conversación directa por HTTP (lo mismo que llegará por WhatsApp/Telegram).
  app.post('/ask', async (c) => {
    const body = await leerJson(c, AskBody);
    if (!body.ok) return body.res;
    try {
      return c.json(await agente.responder(body.data.usuario, body.data.text));
    } catch (e) {
      console.error(e);
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // Contrato de Maritime para contenedores propios: POST /chat { message, source } → { response }.
  app.post('/chat', async (c) => {
    const body = await leerJson(c, ChatBody);
    if (!body.ok) return body.res;
    try {
      return c.json({ response: (await agente.responder('maritime', body.data.message)).respuesta });
    } catch (e) {
      console.error(e);
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // Audios que Zavu descarga para enviarlos por WhatsApp/Telegram. Público a propósito: el nombre es aleatorio de 128 bits.
  app.get('/audio/:archivo', (c) => {
    const a = deps.audio.leer(c.req.param('archivo'));
    if (!a) return c.json({ error: 'No existe' }, 404);
    return c.body(new Uint8Array(a.datos), 200, { 'content-type': a.mime, 'cache-control': 'private, max-age=3600' });
  });

  // Servicio público de matching (Qatom): solo perfil + oportunidad, sin datos privados ni feedback.
  // Con MATCH_TOKEN, Qatom manda ese Authorization (se configura como "Sensitive" en el ítem); sin él, 404 como recomienda su guía.
  // Acepta POST (JSON) o GET (query) y devuelve el id de transacción de Qatom si lo manda.
  const match = async (c: Context) => {
    if (deps.env.MATCH_TOKEN && !tokenValido(c.req.header('authorization'), deps.env.MATCH_TOKEN)) return c.json({ error: 'No encontrado' }, 404);
    const datos = c.req.method === 'GET' ? c.req.query() : await c.req.json().catch(() => undefined);
    const entrada = leerEntradaMatch(datos);
    const transaccion = c.req.header('x-qatom-transaction-id');
    const cabeceras = transaccion ? { 'x-qatom-transaction-id': transaccion } : undefined;
    if (!entrada.ok) return c.json({ error: entrada.error }, 400, cabeceras);
    return c.json({ ...puntuar(entrada.oportunidad, entrada.perfil ?? deps.perfil), ...(transaccion ? { transaction_id: transaccion } : {}) }, 200, cabeceras);
  };
  app.post('/match', match);
  app.get('/match', match);

  // API de solo lectura para el panel (Lovable).
  app.use('/api/*', cors());
  app.use('/api/*', privado);
  app.get('/api/oportunidades', (c) => {
    const filtro = FiltroApi.safeParse(c.req.query());
    if (!filtro.success) return c.json({ error: z.prettifyError(filtro.error) }, 400);
    return c.json(repo.listarOportunidades(deps.db, filtro.data));
  });
  app.get('/api/postulaciones', (c) => c.json(repo.listarPostulaciones(deps.db)));
  app.get('/api/estadisticas', (c) => c.json(repo.estadisticas(deps.db)));

  // Disparadores de n8n: protegidos por JOBS_TOKEN.
  app.use('/jobs/*', async (c, next) => {
    const token = deps.env.JOBS_TOKEN;
    if (!tokenValido(c.req.header('authorization'), token)) return c.json({ error: 'No autorizado' }, 401);
    await next();
  });
  app.post('/jobs/:job', async (c) => {
    const nombre = c.req.param('job');
    if (!(nombre in JOBS)) return c.json({ error: `Job desconocido: ${nombre}`, disponibles: Object.keys(JOBS) }, 404);
    try {
      const r = await JOBS[nombre as NombreJob](deps, agente);
      return c.json(r, r.ok ? 200 : 409);
    } catch (e) {
      console.error(`[job ${nombre}]`, e);
      return c.json({ ok: false, error: (e as Error).message }, 500);
    }
  });

  // Mensajes entrantes (WhatsApp o Telegram vía Zavu). Se contesta 200 al instante y se atiende en segundo plano.
  app.post('/webhook/zavu', async (c) => {
    try {
      const msg = await deps.canal.recibir(c.req.raw);
      if (msg) void mensajeria.procesar(msg);
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof FirmaInvalida) return c.json({ error: e.message }, 401);
      console.error('[webhook]', e);
      return c.json({ ok: true }); // 200 para que Zavu no reintente un evento que no podemos leer
    }
  });

  return Object.assign(app, { mensajeria });
}
