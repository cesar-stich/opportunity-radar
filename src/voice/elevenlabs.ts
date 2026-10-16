import type { Voice } from '../interfaces';

// ElevenLabs = voz: notas de voz → texto (STT) y respuestas/resumen semanal → audio (TTS).

// Mock: el "audio" es texto en UTF-8. Permite probar el flujo de voz completo sin llaves.
export class MockVoice implements Voice {
  nombre = 'mock';
  async transcribir(audio: Uint8Array) {
    return new TextDecoder().decode(audio);
  }
  async sintetizar(texto: string) {
    return { audio: new TextEncoder().encode(texto), mime: 'text/plain' };
  }
}

// Real: pendiente Fase 5.
export class ElevenLabsVoice implements Voice {
  nombre = 'elevenlabs';
  constructor(
    private apiKey?: string,
    private voiceId?: string,
  ) {}
  async transcribir(): Promise<string> {
    throw new Error('ElevenLabs real: pendiente Fase 5 (usa VOICE_MODE=mock)');
  }
  async sintetizar(): Promise<{ audio: Uint8Array; mime: string }> {
    throw new Error('ElevenLabs real: pendiente Fase 5 (usa VOICE_MODE=mock)');
  }
}
