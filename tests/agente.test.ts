import { describe, expect, it } from 'vitest';
import { crearAgente } from '../src/agent/agent';
import * as repo from '../src/db/repo';
import { depsDePrueba } from './helpers';

describe('agente (LLM mock + herramientas reales)', () => {
  it('"¿qué hay para prácticas?" lista y puntúa solo prácticas vigentes', async () => {
    const deps = depsDePrueba();
    const { respuesta, herramientas } = await crearAgente(deps).responder('cesar', '¿qué hay para prácticas?');
    expect(herramientas).toEqual(['listar_oportunidades']);
    expect(respuesta).toMatch(/^1\. \[\d+\/100\]/);
    expect(respuesta).toMatch(/Cloud Engineering/);
    expect(respuesta).not.toMatch(/Hackathon/);
  });

  it('"descarta la 3, no me interesa X" guarda feedback y saca esa oportunidad', async () => {
    const deps = depsDePrueba();
    const agente = crearAgente(deps);
    await agente.responder('cesar', '¿qué hay para prácticas?');
    const lista = repo.listarOportunidades(deps.db, { tipo: 'practica' }).filter((o) => o.estado !== 'descartada' && o.puntaje! > 0);
    const tercera = lista.sort((a, b) => b.puntaje! - a.puntaje!)[2];

    const { herramientas } = await agente.responder('cesar', 'descarta la 3, no me interesa Lima Norte');
    expect(herramientas).toEqual(['registrar_feedback']);

    const fb = repo.listarFeedback(deps.db);
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ accion: 'descartar', oportunidad_id: tercera.id });
    expect(repo.obtenerOportunidad(deps.db, tercera.id)?.estado).toBe('descartada');
    expect(await deps.memoria.buscar('Lima Norte')).toHaveLength(1);
  });

  it('"prepárame el mensaje para postular a la segunda" crea un borrador sin enviarlo', async () => {
    const deps = depsDePrueba();
    const agente = crearAgente(deps);
    await agente.responder('cesar', '¿qué hay para becas?');
    const { respuesta } = await agente.responder('cesar', 'prepárame el mensaje para postular a la segunda');
    expect(respuesta).toMatch(/Borrador #1/);
    expect(respuesta).toMatch(/no se envió nada/);
    expect(repo.listarPostulaciones(deps.db)).toHaveLength(1);
  });

  it('"prácticas en banca" filtra por texto', async () => {
    const { respuesta } = await crearAgente(depsDePrueba()).responder('cesar', '¿qué hay para prácticas en banca?');
    expect(respuesta).toMatch(/Banco Andino/);
    expect(respuesta).not.toMatch(/Nimbus/);
  });

  it('si no hay lista previa, pide el número en vez de inventar', async () => {
    const { respuesta } = await crearAgente(depsDePrueba()).responder('cesar', 'prepárame el borrador para esa');
    expect(respuesta).toMatch(/No sé a cuál/);
  });
});
