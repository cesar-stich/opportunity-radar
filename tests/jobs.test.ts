import { describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { crearAgente } from '../src/agent/agent';
import { MockChannel } from '../src/channels/mock';
import { leerEnv } from '../src/config';
import * as repo from '../src/db/repo';
import type { SearchTool } from '../src/interfaces';
import { escanear, recordarPlazos, resumenSemanal } from '../src/jobs';
import type { OportunidadInput } from '../src/types';
import { hoyISO, sumarDias } from '../src/util/texto';
import { depsDePrueba } from './helpers';

const en = (d: number) => sumarDias(hoyISO(), d);

// Buscador con una oferta que encaja con el perfil y otra que no.
function buscadorFijo(): SearchTool {
  const ofertas: OportunidadInput[] = [
    { titulo: 'Prácticas en Redes 5G', organizacion: 'Telco Real', tipo: 'practica', descripcion: 'Telecomunicaciones y fibra óptica', url: 'https://telco.example.pe/p', ubicacion: 'Lima', modalidad: 'presencial', plazo: en(10), fuente: 'tavily' },
    { titulo: 'Practicante de Ventas', organizacion: 'Tienda X', tipo: 'practica', descripcion: 'Atención en tienda', url: 'https://tienda.example.pe/p', ubicacion: 'Arequipa', modalidad: 'presencial', plazo: en(10), fuente: 'tavily' },
  ];
  return { nombre: 'fijo', buscar: async () => ofertas, enriquecer: async () => '' };
}

function montar(vars: Record<string, string> = { ALLOWED_SENDERS: '123456789' }) {
  const canal = new MockChannel();
  const env = leerEnv({ JOBS_TOKEN: 'secreto', NOTIFY_MIN_SCORE: '70', ...vars });
  const deps = depsDePrueba({ env, canal, buscador: buscadorFijo(), scraper: { nombre: 'vacío', scrapear: async () => [] } });
  return { deps, canal, agente: crearAgente(deps) };
}

describe('job escanear', () => {
  it('avisa solo lo nuevo que supera el umbral y no lo repite', async () => {
    const { deps, canal, agente } = montar();
    const r1 = await escanear(deps, agente);
    expect(r1).toMatchObject({ ok: true, avisados: 1 });
    expect(canal.enviados).toHaveLength(1);
    expect(canal.enviados[0].para).toBe('123456789');
    expect(canal.enviados[0].texto).toMatch(/Prácticas en Redes 5G/);
    expect(canal.enviados[0].texto).not.toMatch(/Ventas/); // bajo el umbral: se guarda pero no molesta
    expect(repo.listarOportunidades(deps.db).some((o) => o.titulo === 'Practicante de Ventas')).toBe(true);

    const r2 = await escanear(deps, agente); // ya conocidas: nada nuevo, ningún aviso
    expect(r2.avisados).toBe(0);
    expect(canal.enviados).toHaveLength(1);
  });

  it('"descarta la 1" después del aviso se refiere a lo que se le avisó', async () => {
    const { deps, agente } = montar();
    await escanear(deps, agente);
    await agente.responder('123456789', 'descarta la 1, no me interesa');
    const aviso = repo.listarOportunidades(deps.db).find((o) => o.titulo === 'Prácticas en Redes 5G');
    expect(aviso?.estado).toBe('descartada');
  });

  it('un umbral más alto avisa menos', async () => {
    const { deps, canal, agente } = montar({ ALLOWED_SENDERS: '1', NOTIFY_MIN_SCORE: '100' });
    expect((await escanear(deps, agente)).avisados).toBe(0);
    expect(canal.enviados).toHaveLength(0);
  });

  it('sin ALLOWED_SENDERS dice por qué no avisa', async () => {
    const { deps, canal, agente } = montar({});
    const r = await escanear(deps, agente);
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/ALLOWED_SENDERS/);
    expect(canal.enviados).toHaveLength(0);
  });
});

describe('job recordar-plazos', () => {
  it('avisa una sola vez lo que te interesa y cierra en 3 días o menos', async () => {
    const { deps, canal, agente } = montar();
    const cierra = repo.listarOportunidades(deps.db).find((o) => o.plazo === en(2))!; // Nimbus, de la semilla
    const otra = repo.listarOportunidades(deps.db).find((o) => o.plazo === en(5))!; // fuera de ventana
    repo.cambiarEstado(deps.db, cierra.id, 'interesa');
    repo.cambiarEstado(deps.db, otra.id, 'interesa');

    const r1 = await recordarPlazos(deps, agente);
    expect(r1.avisados).toBe(1);
    expect(canal.enviados[0].texto).toMatch(new RegExp(cierra.titulo));
    expect(canal.enviados[0].texto).not.toMatch(new RegExp(otra.titulo));
    expect((await recordarPlazos(deps, agente)).avisados).toBe(0);
    expect(canal.enviados).toHaveLength(1);
  });

  it('ignora lo descartado', async () => {
    const { deps, canal, agente } = montar();
    for (const o of repo.listarOportunidades(deps.db)) repo.cambiarEstado(deps.db, o.id, 'descartada');
    expect((await recordarPlazos(deps, agente)).avisados).toBe(0);
    expect(canal.enviados).toHaveLength(0);
  });
});

describe('job resumen-semanal', () => {
  it('siempre manda el resumen con lo mejor y cuántas cierran pronto', async () => {
    const { deps, canal, agente } = montar();
    const r = await resumenSemanal(deps, agente);
    expect(r.ok).toBe(true);
    expect(canal.enviados).toHaveLength(1);
    expect(canal.enviados[0].texto).toMatch(/Resumen de la semana/);
    expect(canal.enviados[0].texto).toMatch(/cierran en 7 días/);
    expect(canal.enviados[0].texto).toMatch(/1\. \[\d+\/100\]/);
  });
});

describe('rutas /jobs/*', () => {
  const post = (path: string, token?: string) =>
    new Request(`http://local${path}`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('exigen el token y devuelven el resultado del job', async () => {
    const { deps, canal } = montar();
    const app = crearApp(deps);
    expect((await app.fetch(post('/jobs/escanear'))).status).toBe(401);
    const res = await app.fetch(post('/jobs/escanear', 'secreto'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, avisados: 1 });
    expect(canal.enviados).toHaveLength(1);
    expect((await app.fetch(post('/jobs/resumen-semanal', 'secreto'))).status).toBe(200);
    expect((await app.fetch(post('/jobs/recordar-plazos', 'secreto'))).status).toBe(200);
  });

  it('aceptan el token también en X-Radar-Token (Maritime no reenvía Authorization)', async () => {
    const { deps } = montar();
    const app = crearApp(deps);
    const con = (cabeceras: Record<string, string>) => new Request('http://local/jobs/recordar-plazos', { method: 'POST', headers: cabeceras });
    expect((await app.fetch(con({ 'x-radar-token': 'secreto' }))).status).toBe(200);
    expect((await app.fetch(con({ 'x-radar-token': 'otro' }))).status).toBe(401);
    // Si el proxy pone su propio Authorization, el token propio sigue valiendo.
    expect((await app.fetch(con({ authorization: 'Bearer del-proxy', 'x-radar-token': 'secreto' }))).status).toBe(200);
  });

  it('responde 409 si no hay a quién avisar', async () => {
    const { deps } = montar({});
    expect((await crearApp(deps).fetch(post('/jobs/escanear', 'secreto'))).status).toBe(409);
  });
});

