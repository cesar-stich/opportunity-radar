import { describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { leerEnv } from '../src/config';
import { depsDePrueba } from './helpers';

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://local${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('servidor', () => {
  const app = crearApp(depsDePrueba());

  it('/health', async () => {
    const res = await app.request('/health');
    expect(await res.json()).toMatchObject({ ok: true, llm: 'mock' });
  });

  it('/ask responde', async () => {
    const res = await app.fetch(post('/ask', { text: 'hola' }));
    expect(res.status).toBe(200);
    expect((await res.json()).respuesta).toMatch(/Radar/);
  });

  it('/ask valida el cuerpo', async () => {
    expect((await app.fetch(post('/ask', { texto: 'mal' }))).status).toBe(400);
  });

  it('/match devuelve puntaje y razones', async () => {
    const res = await app.fetch(post('/match', { oportunidad: { titulo: 'Beca de IA', tipo: 'beca', ubicacion: 'Lima' } }));
    const json = await res.json();
    expect(json.puntaje).toBeGreaterThan(50);
    expect(json.razones.length).toBeGreaterThan(0);
  });

  it('/api/* expone datos de solo lectura', async () => {
    expect(await (await app.request('/api/oportunidades')).json()).toHaveLength(15);
    expect((await (await app.request('/api/estadisticas')).json()).total).toBe(15);
  });

  it('en producción /ask y /api/* exigen API_TOKEN (y sin token configurado quedan cerrados)', async () => {
    const cerrada = crearApp(depsDePrueba({ env: leerEnv({ NODE_ENV: 'production' }) }));
    expect((await cerrada.fetch(post('/ask', { text: 'hola' }))).status).toBe(401);
    expect((await cerrada.request('/api/oportunidades')).status).toBe(401);

    const abierta = crearApp(depsDePrueba({ env: leerEnv({ NODE_ENV: 'production', API_TOKEN: 'llave' }) }));
    expect((await abierta.fetch(post('/ask', { text: 'hola' }))).status).toBe(401);
    expect((await abierta.fetch(post('/ask', { text: 'hola' }, { authorization: 'Bearer llave' }))).status).toBe(200);
    expect((await abierta.request('/api/oportunidades', { headers: { authorization: 'Bearer llave' } })).status).toBe(200);
    // /match y /health siguen públicos (Qatom y los chequeos de salud no llevan token)
    expect((await abierta.fetch(post('/match', { oportunidad: { titulo: 'Beca', tipo: 'beca' } }))).status).toBe(200);
    expect((await abierta.request('/health')).status).toBe(200);
  });

  it('/chat cumple el contrato de Maritime', async () => {
    const res = await app.fetch(post('/chat', { message: 'hola', source: 'front_door' }));
    expect(res.status).toBe(200);
    expect((await res.json()).response).toMatch(/Radar/);
  });

  it('/jobs/* exige JOBS_TOKEN', async () => {
    expect((await app.fetch(post('/jobs/escanear', {}))).status).toBe(401);
    expect((await app.fetch(post('/jobs/inexistente', {}, { authorization: 'Bearer secreto' }))).status).toBe(404);
  });
});
