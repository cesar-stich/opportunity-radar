import type { DB } from '../db/index';
import type { LLMProvider, Mensaje, MemoryStore } from '../interfaces';
import type { Perfil } from '../types';
import { promptSistema } from './prompt';
import { ejecutarHerramienta, HERRAMIENTAS, type Sesion } from './tools';

// Bucle del agente: el LLM decide qué herramienta usar, nosotros la ejecutamos y le devolvemos el resultado,
// hasta que responde con texto. Las sesiones guardan solo texto (no las llamadas) para mantener el contexto corto.

const MAX_PASOS = 6;
const MAX_HISTORIAL = 12;

export type AgenteDeps = { db: DB; perfil: Perfil; memoria: MemoryStore; llm: LLMProvider };

export function crearAgente(deps: AgenteDeps) {
  const sesiones = new Map<string, Sesion>();
  const tools = HERRAMIENTAS.map((h) => h.spec);

  async function responder(usuario: string, texto: string): Promise<{ respuesta: string; herramientas: string[] }> {
    const sesion = sesiones.get(usuario) ?? { historial: [], ultimaLista: [] };
    sesiones.set(usuario, sesion);
    const ctx = { ...deps, sesion };
    const mensajes: Mensaje[] = [...sesion.historial, { role: 'user', text: texto }];
    const usadas: string[] = [];
    let respuesta: string | undefined;

    for (let paso = 0; paso < MAX_PASOS && respuesta === undefined; paso++) {
      const r = await deps.llm.chat({ system: promptSistema(deps.perfil), mensajes, tools });
      if (!r.toolCalls?.length) {
        respuesta = r.text?.trim() || '…';
        break;
      }
      mensajes.push({ role: 'assistant', text: r.text, toolCalls: r.toolCalls, raw: r.raw });
      const results = [];
      for (const tc of r.toolCalls) {
        usadas.push(tc.name);
        results.push({ id: tc.id, name: tc.name, result: await ejecutarHerramienta(tc.name, tc.args, ctx) });
      }
      mensajes.push({ role: 'tool', results });
    }
    respuesta ??= 'Me enredé con tantos pasos 😅 ¿Me lo dices de otra forma?';

    sesion.historial.push({ role: 'user', text: texto }, { role: 'assistant', text: respuesta });
    sesion.historial = sesion.historial.slice(-MAX_HISTORIAL);
    return { respuesta, herramientas: usadas };
  }

  return { responder };
}

export type Agente = ReturnType<typeof crearAgente>;
