import { timingSafeEqual } from 'node:crypto';
import type { AudioEntrante, Channel, MensajeEntrante } from '../interfaces';
import { aTextoPlano } from '../util/formato';
import { FirmaInvalida, partirTexto } from './zavu';

// Telegram directo (Bot API, https://core.telegram.org/bots/api). Se usa en vez de Zavu porque Zavu no nos pasa
// las notas de voz de Telegram (llegan como texto vacío, sin file_id). Aquí el webhook es de Telegram mismo:
//  - Recibir: `setWebhook` con `secret_token`; Telegram lo manda en `X-Telegram-Bot-Api-Secret-Token`.
//  - Audio entrante: el update trae `voice.file_id` → `getFile` → descarga desde /file/bot<token>/<file_path>.
//  - Enviar: `sendMessage` (texto) y `sendVoice`/`sendAudio` (bytes por multipart: no hace falta URL pública).
// Un bot solo puede tener un webhook: al registrar este, Zavu deja de recibir los mensajes de ese bot.

const API = 'https://api.telegram.org';

type Update = {
  update_id?: number;
  message?: {
    message_id?: number;
    chat?: { id?: number; type?: string };
    text?: string;
    voice?: { file_id?: string; mime_type?: string };
    audio?: { file_id?: string; mime_type?: string };
  };
};

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class TelegramChannel implements Channel {
  nombre = 'telegram';

  constructor(
    private token: string,
    private secreto: string,
  ) {}

  private async llamar<T>(metodo: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API}/bot${this.token}/${metodo}`, { ...init, signal: AbortSignal.timeout(30_000) });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !json?.ok) throw new Error(`Telegram ${metodo} ${res.status}: ${json?.description ?? 'sin detalle'}`);
    return json.result as T;
  }

  private post(metodo: string, cuerpo: unknown) {
    return this.llamar(metodo, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  }

  // Le dice a Telegram a dónde mandar los mensajes. Se llama al arrancar con PUBLIC_URL (la URL del túnel cambia).
  async registrarWebhook(urlPublica: string): Promise<void> {
    await this.post('setWebhook', {
      url: `${urlPublica.replace(/\/$/, '')}/webhook/telegram`,
      secret_token: this.secreto,
      allowed_updates: ['message'],
    });
  }

  async recibir(req: Request): Promise<MensajeEntrante | null> {
    // Sin esta cabecera cualquiera podría falsificar mensajes en el webhook público.
    if (!iguales(req.headers.get('x-telegram-bot-api-secret-token') ?? '', this.secreto)) throw new FirmaInvalida('Secreto de webhook incorrecto');
    const up = (await req.json().catch(() => null)) as Update | null;
    const m = up?.message;
    if (!m?.chat?.id) return null;
    const base = { de: String(m.chat.id), id: up?.update_id !== undefined ? String(up.update_id) : undefined };
    const nota = m.voice ?? m.audio;
    if (nota?.file_id) return { ...base, audio: { mensajeId: nota.file_id, mime: nota.mime_type } };
    return m.text?.trim() ? { ...base, texto: m.text.trim() } : null;
  }

  async enviarTexto(para: string, texto: string): Promise<void> {
    for (const trozo of partirTexto(aTextoPlano(texto, 'telegram'))) await this.post('sendMessage', { chat_id: para, text: trozo });
  }

  // sendVoice solo acepta OGG/Opus; ElevenLabs entrega mp3, que va por sendAudio.
  async enviarAudio(para: string, audio: Uint8Array, mime: string): Promise<void> {
    const voz = mime.includes('ogg') || mime.includes('opus');
    const form = new FormData();
    form.set('chat_id', para);
    form.set(voz ? 'voice' : 'audio', new Blob([audio as BlobPart], { type: mime }), voz ? 'audio.ogg' : 'audio.mp3');
    await this.llamar(voz ? 'sendVoice' : 'sendAudio', { method: 'POST', body: form });
  }

  async obtenerAudio(audio: AudioEntrante): Promise<{ datos: Uint8Array; mime: string }> {
    if (!audio.mensajeId) throw new Error('Telegram no entregó el file_id de la nota de voz');
    const f = await this.post('getFile', { file_id: audio.mensajeId }) as { file_path?: string };
    if (!f.file_path) throw new Error('Telegram no devolvió file_path para el audio');
    const res = await fetch(`${API}/file/bot${this.token}/${f.file_path}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`No se pudo bajar el audio de Telegram (${res.status})`);
    return { datos: new Uint8Array(await res.arrayBuffer()), mime: audio.mime ?? 'audio/ogg' };
  }
}
