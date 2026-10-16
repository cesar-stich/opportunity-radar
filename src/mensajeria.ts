import type { Agente } from './agent/agent';
import type { Channel, MensajeEntrante, Voice } from './interfaces';
import { textoParaVoz } from './util/voz';

// Une el canal (Zavu) con el agente: mensaje entrante → agente → respuesta por el mismo canal.
// Zavu exige responder al webhook en <30 s y el LLM puede tardar más, así que el webhook contesta 200 al
// instante y esto corre en segundo plano. Zavu reintenta las entregas, por eso también deduplicamos.
// Notas de voz: audio → ElevenLabs (STT) → agente → (si REPLY_AS_VOICE) ElevenLabs (TTS) → audio. Si algo de la
// voz falla, siempre queda la respuesta por texto.

export type Mensajeria = {
  procesar(msg: MensajeEntrante): Promise<void>;
  // Resuelve cuando no queda nada en curso (para tests y para apagar el servidor sin cortar respuestas).
  inactivo(): Promise<void>;
};

const MAX_VISTOS = 500;

export function crearMensajeria(deps: {
  canal: Channel;
  agente: Agente;
  permitidos: string[];
  voz: Voice;
  responderEnVoz: boolean;
}): Mensajeria {
  const { canal, agente, permitidos, voz, responderEnVoz } = deps;
  const vistos = new Set<string>();
  const enCurso = new Set<Promise<void>>();

  // Nota de voz → texto. Devuelve undefined (y avisa al usuario) si no se pudo.
  async function transcribir(msg: MensajeEntrante): Promise<string | undefined> {
    try {
      const a = msg.audio!;
      const { datos, mime } = a.datos ? { datos: a.datos, mime: a.mime ?? 'audio/ogg' } : await canal.obtenerAudio!(a);
      const texto = (await voz.transcribir(datos, mime)).trim();
      if (texto) return texto;
      await canal.enviarTexto(msg.de, 'No te entendí la nota de voz 🎙️ ¿Me la repites o me escribes?');
    } catch (e) {
      console.error('[voz] no se pudo transcribir:', e);
      await canal.enviarTexto(msg.de, 'No pude escuchar tu nota de voz 😕 Escríbeme por ahora.');
    }
    return undefined;
  }

  async function atender(msg: MensajeEntrante) {
    // Solo el dueño puede hablar con el agente: el bot de Telegram es público y cada pregunta gasta cuota (Tavily, LLM).
    if (!permitidos.includes(msg.de)) {
      console.warn(`[canal] mensaje de un remitente no permitido: ${msg.de}`);
      const ayuda = permitidos.length
        ? 'Este agente es privado.'
        : `Este agente aún no tiene dueño. Tu ID es ${msg.de}: ponlo en ALLOWED_SENDERS en el .env y reinicia el servidor.`;
      await canal.enviarTexto(msg.de, ayuda);
      return;
    }
    let texto = msg.texto;
    const eraVoz = !texto && !!msg.audio;
    if (eraVoz) {
      if (!msg.audio!.datos && !canal.obtenerAudio) {
        await canal.enviarTexto(msg.de, 'Este canal no me deja bajar tus notas de voz. Escríbeme por ahora.');
        return;
      }
      texto = await transcribir(msg);
      if (!texto) return;
    }
    if (!texto) {
      await canal.enviarTexto(msg.de, 'Por ahora solo leo texto y notas de voz.');
      return;
    }
    try {
      const { respuesta } = await agente.responder(msg.de, texto);
      if (eraVoz && responderEnVoz) {
        try {
          const { audio, mime } = await voz.sintetizar(textoParaVoz(respuesta));
          await canal.enviarAudio(msg.de, audio, mime);
          return;
        } catch (e) {
          console.error('[voz] no se pudo responder en audio, va por texto:', e);
        }
      }
      // Si venía de voz, se muestra qué se entendió: así se nota si la transcripción falló.
      await canal.enviarTexto(msg.de, eraVoz ? `🎙️ Te escuché: «${texto}»\n\n${respuesta}` : respuesta);
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
