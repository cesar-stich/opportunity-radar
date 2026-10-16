import { describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { leerEnv } from '../src/config';
import { leerEntradaMatch } from '../src/match';
import { tokenValido } from '../src/util/token';
import { depsDePrueba } from './helpers';

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://local${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('tokenValido', () => {
  it('exige Bearer exacto', () => {
    expect(tokenValido('Bearer abc', 'abc')).toBe(true);
    expect(tokenValido('Bearer abd', 'abc')).toBe(false);
    expect(tokenValido('abc', 'abc')).toBe(false);
    expect(tokenValido(undefined, 'abc')).toBe(false);
    expect(tokenValido('Bearer ', undefined)).toBe(false);
  });
});

describe('panel: PANEL_TOKEN es solo lectura', () => {
  const app = crearApp(depsDePrueba({ env: leerEnv({ NODE_ENV: 'production', API_TOKEN: 'admin', PANEL_TOKEN: 'panel' }) }));
  const con = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

  it('lee /api/* con cualquiera de los dos tokens', async () => {
    expect((await app.request('/api/oportunidades', con('panel'))).status).toBe(200);
    expect((await app.request('/api/estadisticas', con('panel'))).status).toBe(200);
    expect((await app.request('/api/postulaciones', con('admin'))).status).toBe(200);
    expect((await app.request('/api/oportunidades', con('otro'))).status).toBe(401);
  });

  it('el token del panel no sirve para conversar con el agente', async () => {
    expect((await app.fetch(json('/ask', { text: 'hola' }, { authorization: 'Bearer panel' }))).status).toBe(401);
    expect((await app.fetch(json('/chat', { message: 'hola' }, { authorization: 'Bearer panel' }))).status).toBe(401);
    expect((await app.fetch(json('/ask', { text: 'hola' }, { authorization: 'Bearer admin' }))).status).toBe(200);
  });

  it('permite el preflight CORS del navegador', async () => {
    const res = await app.request('/api/oportunidades', { method: 'OPTIONS', headers: { origin: 'https://panel.lovable.app', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });
});

describe('/match para Qatom', () => {
  it('acepta la forma plana: oportunidad + perfil en texto separado por comas', async () => {
    const app = crearApp(depsDePrueba());
    const res = await app.fetch(json('/match', { titulo: 'Beca en nube', tipo: 'beca', descripcion: 'Curso de cloud y AWS', ubicacion: 'Lima', intereses: 'cloud, datos', busca: 'becas', ubicacion_perfil: 'Lima, Perú' }));
    const r = await res.json();
    expect(res.status).toBe(200);
    expect(r.puntaje).toBeGreaterThan(70);
    expect(r.razones.join(' ')).toMatch(/cloud/);
  });

  it('un perfil distinto cambia el puntaje (no usa el del dueño)', async () => {
    const app = crearApp(depsDePrueba());
    const op = { titulo: 'Beca en nube', tipo: 'beca', descripcion: 'cloud', ubicacion: 'Lima' };
    const a = await (await app.fetch(json('/match', { ...op, intereses: 'cloud', busca: 'becas' }))).json();
    const b = await (await app.fetch(json('/match', { ...op, intereses: 'arte', busca: 'cursos' }))).json();
    expect(a.puntaje).toBeGreaterThan(b.puntaje);
  });

  it('también funciona por GET con query string y devuelve el id de transacción', async () => {
    const app = crearApp(depsDePrueba());
    const res = await app.request('/match?titulo=Hackathon%20IA&tipo=hackathon', { headers: { 'x-qatom-transaction-id': 'tx_123' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-qatom-transaction-id')).toBe('tx_123');
    expect((await res.json()).transaction_id).toBe('tx_123');
  });

  it('errores con código, mensaje y siguiente paso; rechaza parámetros desconocidos', async () => {
    const app = crearApp(depsDePrueba());
    const malo = await app.fetch(json('/match', { titulo: 'X', tipo: 'inventado' }));
    expect(malo.status).toBe(400);
    expect((await malo.json()).error).toMatchObject({ code: 'invalid_input', next_step: expect.stringContaining('titulo') });
    const extra = await app.fetch(json('/match', { titulo: 'X', tipo: 'beca', colorFavorito: 'azul' }));
    expect(extra.status).toBe(400);
    expect((await extra.json()).error.code).toBe('unknown_parameter');
  });

  it('con MATCH_TOKEN responde 404 si falta o es incorrecto (como recomienda Qatom)', async () => {
    const app = crearApp(depsDePrueba({ env: leerEnv({ MATCH_TOKEN: 'qatom-secreto' }) }));
    const cuerpo = { titulo: 'Beca', tipo: 'beca' };
    expect((await app.fetch(json('/match', cuerpo))).status).toBe(404);
    expect((await app.fetch(json('/match', cuerpo, { authorization: 'Bearer malo' }))).status).toBe(404);
    expect((await app.fetch(json('/match', cuerpo, { authorization: 'Bearer qatom-secreto' }))).status).toBe(200);
  });

  it('mantiene la forma anidada original', () => {
    const r = leerEntradaMatch({ oportunidad: { titulo: 'Beca de IA', tipo: 'beca' } });
    expect(r.ok).toBe(true);
  });
});
