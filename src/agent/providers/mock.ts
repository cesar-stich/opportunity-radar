import type { LLMProvider, Mensaje, RespuestaLLM, ToolCall } from '../../interfaces';
import type { Tipo } from '../../types';
import { normalizar } from '../../util/texto';

// LLM falso basado en reglas: entiende las frases típicas y llama a las mismas herramientas que un LLM real.
// Sirve para probar todo el flujo sin llaves ni internet.

const ORDINALES: Record<string, number> = { primer: 1, segund: 2, tercer: 3, cuart: 4, quint: 5 };

function posicion(t: string): number | undefined {
  const num = t.match(/(?:\bla|\bel|#|\bnumero|\bnro\.?|\bopcion)\s*(\d{1,2})\b/);
  if (num) return Number(num[1]);
  const ord = t.match(/\b(primer|segund|tercer|cuart|quint)[ao]?\b/);
  return ord ? ORDINALES[ord[1]] : undefined;
}

function tipo(t: string): Tipo | undefined {
  if (/practica|pasantia|internship/.test(t)) return 'practica';
  if (/beca/.test(t)) return 'beca';
  if (/hackat/.test(t)) return 'hackathon';
  if (/curso/.test(t)) return 'curso';
  if (/convocatoria|concurso/.test(t)) return 'convocatoria';
  return undefined;
}

let contador = 0;
const llamar = (name: string, args: Record<string, unknown>): RespuestaLLM => ({
  toolCalls: [{ id: `mock-${++contador}`, name, args: Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)) } as ToolCall],
});

export class MockLLM implements LLMProvider {
  nombre = 'mock';

  async chat({ mensajes }: { mensajes: Mensaje[] }): Promise<RespuestaLLM> {
    const ultimo = mensajes.at(-1);
    // Después de usar herramientas: responde con sus resúmenes.
    if (ultimo?.role === 'tool') {
      return {
        text: ultimo.results
          .map(({ result }) => {
            const r = result as { ok: boolean; resumen?: string; error?: string };
            return r.ok ? r.resumen : `Uy, no pude: ${r.error}`;
          })
          .join('\n\n'),
      };
    }
    if (ultimo?.role !== 'user') return { text: '' };

    const original = ultimo.text;
    const t = normalizar(original);
    const pos = posicion(t);

    // "busca prácticas de telecom en Lima" → búsqueda nueva en la web; "escanea" → fuentes configuradas.
    if (/escanea|revisa las fuentes|busca (algo )?nuevo/.test(t)) return llamar('buscar_oportunidades', {});
    const VERBO_BUSCAR = /^[\s¿¡]*(?:radar,?\s*)?(?:b[uú]scame|busca|encu[eé]ntrame|encuentra|descubre)\s+/i;
    if (VERBO_BUSCAR.test(original)) return llamar('buscar_oportunidades', { consulta: original.replace(VERBO_BUSCAR, '').replace(/[?¿!.]+\s*$/, '') });
    if (/investiga|averigua|cuentame (mas|de)|mas info|que se sabe/.test(t)) return llamar('enriquecer_oportunidad', { posicion: pos });
    if (/descart|no me interesa|no me gusta|quitala|borrala/.test(t))
      return llamar('registrar_feedback', { accion: 'descartar', motivo: original, posicion: pos });
    if (/borrador|preparame|postular|redacta|mensaje para/.test(t)) return llamar('redactar_borrador', { posicion: pos });
    if (/me interesa|me gusta|guardala|me late/.test(t)) return llamar('registrar_feedback', { accion: 'aceptar', motivo: original, posicion: pos });
    if (/puntua|puntaje|que tal|detalle/.test(t) && pos) return llamar('puntuar_oportunidad', { posicion: pos });
    if (/que hay|muestra|lista|dame|tienes|hay algo/.test(t) || tipo(t)) {
      const texto = t.match(/\ben ([a-z ]{3,30}?)\??$/)?.[1]?.trim();
      return llamar('listar_oportunidades', { tipo: tipo(t), texto });
    }
    return {
      text:
        '¡Hola! Soy Radar 📡 (modo mock). Prueba: "¿qué hay para prácticas?", "descarta la 3, no me interesa X", ' +
        '"prepárame el mensaje para postular a la segunda".',
    };
  }
}
