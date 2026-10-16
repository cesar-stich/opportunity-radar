import type { Agente } from './agent/agent';
import type { Channel, MensajeEntrante } from './interfaces';

// Une el canal (Zavu) con el agente: mensaje entrante → agente → respuesta por el mismo canal.
// Zavu exige responder al webhook en <30 s y el LLM puede tardar más, así que el webhook contesta 200 al
// instante y esto corre en segundo plano. Zavu reintenta las entregas, por eso también deduplicamos.

export type Mensajeria = {
  procesar(msg: MensajeEntrante): Promise<void>;
  // Resuelve cuando no queda nada en curso (para tests y para apagar el servidor sin cortar respuestas).
  inactivo(): Promise<void>;
};

const MAX_VISTOS = 500;

export function crearMensajeria(deps: { canal: Channel; agente: Agente; permitidos: string[] }): Mensajeria {
  const { canal, agente, permitidos } = deps;
  const vistos = new Set<string>();
  const enCurso = new Set<Promise<void>>();

  async function atender(msg: MensajeEntrante) {
    // Solo el dueño puede hablar con el agente: el bot es público en Telegram y cada pregunta gasta cuota (Tavily, LLM).
    if (!permitidos.includes(msg.de)) {
      console.warn(`[canal] mensaje de un remitente no permitido: ${msg.de}`);
      const ayuda = permitidos.length
        ? 'Este agente es privado.'
        : `Este agente aún no tiene dueño. Tu ID es ${msg.de}: ponlo en ALLOWED_SENDERS en el .env y reinicia el servidor.`;
      await canal.enviarTexto(msg.de, ayuda);
      return;
    }
    if (!msg.texto) {
      await canal.enviarTexto(msg.de, msg.audio ? 'Todavía no entiendo notas de voz 🎙️ (llega en la Fase 5). Escríbeme por ahora.' : 'Por ahora solo leo texto.');
      return;
    }
    try {
      const { respuesta } = await agente.responder(msg.de, msg.texto);
      await canal.enviarTexto(msg.de, respuesta);
    } catch (e) {
      console.error('[canal] el agente falló:', e);
      await canal.enviarTexto(msg.de, 'Uy, me enredé procesando eso 😅 Inténtalo de nuevo en un momento.').catch(() => {});
    }
  }

  return {
    procesar(msg) {
      if (msg.id) {
        if (vistos.has(msg.id)) return Promise.resolve();
        vistos.add(msg.id);
        if (vistos.size > MAX_VISTOS) vistos.delete(vistos.values().next().value!);
      }
      const p = atender(msg)
        .catch((e) => console.error('[canal] no se pudo responder:', e))
        .finally(() => enCurso.delete(p));
      enCurso.add(p);
      return p;
    },
    async inactivo() {
      while (enCurso.size) await Promise.all(enCurso);
    },
  };
}
