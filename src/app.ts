import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { crearAgente } from './agent/agent';
import { puntuar } from './agent/scoring';
import * as repo from './db/repo';
import type { Deps } from './deps';
import { ESTADOS, ParaPuntuarSchema, PerfilSchema, TIPOS } from './types';

// Servidor del agente: el cerebro vive aquí. Zavu solo transporta, n8n solo dispara, Maritime solo aloja.

const AskBody = z.object({ text: z.string().min(1), usuario: z.string().default('local') });
const MatchBody = z.object({ perfil: PerfilSchema.optional(), oportunidad: ParaPuntuarSchema });
const FiltroApi = z.object({ estado: z.enum(ESTADOS).optional(), tipo: z.enum(TIPOS).optional() });

async function leerJson<T extends z.ZodType>(c: Context, schema: T) {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success
    ? ({ ok: true, data: parsed.data } as const)
    : ({ ok: false, res: c.json({ error: z.prettifyError(parsed.error) }, 400) } as const);
}

export function crearApp(deps: Deps) {
  const app = new Hono();
  const agente = crearAgente(deps);

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

  // Servicio público de matching (Qatom): solo perfil + oportunidad, sin datos privados ni feedback.
  app.post('/match', async (c) => {
    const body = await leerJson(c, MatchBody);
    if (!body.ok) return body.res;
    return c.json(puntuar(body.data.oportunidad, body.data.perfil ?? deps.perfil));
  });

  // API de solo lectura para el panel (Lovable).
  app.use('/api/*', cors());
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
    if (!token || c.req.header('authorization') !== `Bearer ${token}`) return c.json({ error: 'No autorizado' }, 401);
    await next();
  });
  app.post('/jobs/:job', (c) => c.json({ error: `Job "${c.req.param('job')}": pendiente Fase 6` }, 501));

  app.post('/webhook/zavu', (c) => c.json({ error: 'Webhook de Zavu: pendiente Fase 4' }, 501));

  return app;
}
