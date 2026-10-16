import { describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
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

  it('/jobs/* exige JOBS_TOKEN', async () => {
    expect((await app.fetch(post('/jobs/escanear', {}))).status).toBe(401);
    expect((await app.fetch(post('/jobs/inexistente', {}, { authorization: 'Bearer secreto' }))).status).toBe(404);
  });
});
