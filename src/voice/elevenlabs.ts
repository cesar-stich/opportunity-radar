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

// ---------- Real: API de ElevenLabs (https://elevenlabs.io/docs, verificada el 2026-10-16) ----------
// STT: POST /v1/speech-to-text (multipart: model_id, file) → { text }. Auth: header `xi-api-key`.
// TTS: POST /v1/text-to-speech/{voice_id}?output_format=… { text, model_id } → bytes de audio.
// Plan Free: 10,000 créditos/mes compartidos (la doc no aclara si incluye API ni si pide tarjeta). Por eso el
// texto que se pronuncia se acorta (src/util/voz.ts) y se guarda mp3 de 64 kbps, suficiente para voz.

const API = 'https://api.elevenlabs.io/v1';
const MODELO_STT = 'scribe_v2';
const MODELO_TTS = 'eleven_multilingual_v2'; // el de la doc por defecto; entiende español
const FORMATO = 'mp3_44100_64';

export class ElevenLabsVoice implements Voice {
  nombre = 'elevenlabs';
  constructor(
    private apiKey?: string,
    private voiceId?: string,
  ) {}

  private llave(): string {
    if (!this.apiKey) throw new Error('VOICE_MODE=real requiere ELEVENLABS_API_KEY en .env');
    return this.apiKey;
  }

  private async fallo(res: Response): Promise<never> {
    const cuerpo = (await res.text()).slice(0, 300);
    const pista = res.status === 401 ? ' (llave inválida)' : res.status === 429 || res.status === 402 ? ' (sin créditos o demasiadas llamadas)' : '';
    throw new Error(`ElevenLabs ${res.status}${pista}: ${cuerpo}`);
  }

  async transcribir(audio: Uint8Array, mime: string): Promise<string> {
    const form = new FormData();
    form.set('model_id', MODELO_STT);
    form.set('file', new Blob([audio as BlobPart], { type: mime || 'audio/ogg' }), 'nota-de-voz');
    const res = await fetch(`${API}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': this.llave() }, body: form, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) await this.fallo(res);
    return ((await res.json()) as { text?: string }).text?.trim() ?? '';
  }

  async sintetizar(texto: string): Promise<{ audio: Uint8Array; mime: string }> {
    const llave = this.llave();
    if (!this.voiceId) throw new Error('VOICE_MODE=real requiere ELEVENLABS_VOICE_ID en .env (elige una voz en elevenlabs.io → Voices)');
    const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(this.voiceId)}?output_format=${FORMATO}`, {
      method: 'POST',
      headers: { 'xi-api-key': llave, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: texto, model_id: MODELO_TTS }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) await this.fallo(res);
    return { audio: new Uint8Array(await res.arrayBuffer()), mime: 'audio/mpeg' };
  }
}
