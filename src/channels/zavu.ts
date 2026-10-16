import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AudioEntrante, Channel, MensajeEntrante } from '../interfaces';
import type { AlmacenAudio } from '../voice/almacen';
import { aTextoPlano } from '../util/formato';

// Zavu = solo transporte de mensajes (WhatsApp primero, Telegram de respaldo). El cerebro está en el servidor.

// Mock: imprime en consola y guarda lo enviado (útil en tests). Webhook esperado: { de, texto }.
export class MockChannel implements Channel {
  nombre = 'mock';
  enviados: { para: string; texto?: string; audioBytes?: number }[] = [];

  async recibir(req: Request): Promise<MensajeEntrante | null> {
    const body = (await req.json().catch(() => null)) as { de?: string; texto?: string } | null;
    if (!body?.de || !body.texto) return null;
    return { de: body.de, texto: body.texto };
  }

  async enviarTexto(para: string, texto: string) {
    this.enviados.push({ para, texto });
    console.log(`[canal mock → ${para}] ${texto}`);
  }

  async enviarAudio(para: string, audio: Uint8Array) {
    this.enviados.push({ para, audioBytes: audio.byteLength });
    console.log(`[canal mock → ${para}] (audio de ${audio.byteLength} bytes)`);
  }
}

// ---------- Real: API de Zavu (https://docs.zavu.dev, verificada el 2026-10-16) ----------
// Una sola clase para WhatsApp y Telegram: Zavu usa el mismo contrato de envío y de webhook para los dos.
//  - Enviar: POST https://api.zavu.dev/v1/messages  { to, text, channel }  con `Authorization: Bearer zv_…`
//    (`Zavu-Sender: snd_…` elige el sender si la cuenta tiene varios). Responde 202.
//  - Recibir: webhook del sender, evento `message.inbound`, firmado en `X-Zavu-Signature`.
//  - Telegram: `to` es el chat id numérico (llega en `data.from`); el usuario debe escribirle primero al bot. Es gratis.
//  - WhatsApp: texto libre solo dentro de las 24 h del último mensaje del usuario; fuera de eso Zavu exige plantilla.
//    Por eso los avisos proactivos (Fase 6) van mejor por Telegram.

export class FirmaInvalida extends Error {}

const API = 'https://api.zavu.dev/v1/messages';
const MAX_TEXTO = 3500; // WhatsApp y Telegram aceptan ~4096 caracteres; dejamos margen
const TOLERANCIA_SEG = 300; // la doc: rechazar firmas de hace más de 5 min o más de 60 s en el futuro
const ADELANTO_SEG = 60;

// Verifica X-Zavu-Signature: `t=<unix>,v2=<hex>` donde v2 = HMAC_SHA256(secreto, "{t}.{cuerpo}")
// (v1, de webhooks antiguos, firma solo el cuerpo). Compara en tiempo constante.
export function verificarFirma(secreto: string, cuerpo: string, cabecera: string | null, ahoraSeg = Date.now() / 1000): void {
  if (!cabecera) throw new FirmaInvalida('Falta X-Zavu-Signature');
  const partes = Object.fromEntries(cabecera.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  const t = Number(partes.t);
  if (!Number.isFinite(t)) throw new FirmaInvalida('Firma sin timestamp');
  const edad = ahoraSeg - t;
  if (edad > TOLERANCIA_SEG || edad < -ADELANTO_SEG) throw new FirmaInvalida('Firma fuera de la ventana de tiempo');
  const recibida = partes.v2 ?? partes.v1;
  if (!recibida) throw new FirmaInvalida('Firma sin v1 ni v2');
  const firmado = partes.v2 ? `${t}.${cuerpo}` : cuerpo;
  const esperada = createHmac('sha256', secreto).update(firmado).digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(recibida);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new FirmaInvalida('Firma incorrecta');
}

// Parte un texto largo en trozos por saltos de línea (sin cortar palabras si se puede).
export function partirTexto(texto: string, max = MAX_TEXTO): string[] {
  const trozos: string[] = [];
  let resto = texto.trim();
  while (resto.length > max) {
    const corte = Math.max(resto.lastIndexOf('\n', max), resto.lastIndexOf(' ', max));
    const n = corte > max / 2 ? corte : max;
    trozos.push(resto.slice(0, n).trim());
    resto = resto.slice(n).trim();
  }
  if (resto) trozos.push(resto);
  return trozos;
}

type EventoZavu = {
  type?: string;
  data?: {
    messageId?: string;
    from?: string;
    channel?: string;
    messageType?: string;
    text?: string;
    content?: { mimeType?: string; mediaId?: string; mediaUrl?: string };
  };
};

export class ZavuChannel implements Channel {
  constructor(
    public nombre: 'zavu-whatsapp' | 'zavu-telegram',
    private apiKey?: string,
    private webhookSecret?: string,
    private senderId?: string,
    private almacen?: AlmacenAudio,
  ) {}

  private get canal() {
    return this.nombre === 'zavu-telegram' ? 'telegram' : 'whatsapp';
  }

  async recibir(req: Request): Promise<MensajeEntrante | null> {
    const cuerpo = await req.text(); // el cuerpo crudo: la firma se calcula sobre estos bytes exactos
    if (this.webhookSecret) verificarFirma(this.webhookSecret, cuerpo, req.headers.get('x-zavu-signature'));
    let ev: EventoZavu;
    try {
      ev = JSON.parse(cuerpo);
    } catch {
      return null;
    }
    // Acuses (message.sent / delivered…) y otros eventos no son mensajes del usuario.
    if (ev.type !== 'message.inbound' && ev.type !== 'conversation.new') return null;
    const d = ev.data;
    if (!d?.from) return null;
    const base = { de: d.from, id: d.messageId };
    if (d.messageType === 'audio' || d.messageType === 'voice')
      return { ...base, audio: { mime: d.content?.mimeType, url: d.content?.mediaUrl, mensajeId: d.messageId } };
    // Otros tipos (imagen, ubicación…) se ignoran: solo texto y notas de voz.
    return d.text?.trim() ? { ...base, texto: d.text.trim() } : null;
  }

  private cabeceras() {
    if (!this.apiKey) throw new Error('CHANNEL real requiere ZAVU_API_KEY en .env');
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      ...(this.senderId ? { 'zavu-sender': this.senderId } : {}),
    };
  }

  private async enviar(cuerpo: Record<string, unknown>): Promise<void> {
    const res = await fetch(API, {
      method: 'POST',
      headers: this.cabeceras(),
      body: JSON.stringify({ channel: this.canal, ...cuerpo }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Zavu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  async enviarTexto(para: string, texto: string): Promise<void> {
    // Zavu no garantiza el formato Markdown del LLM en cada canal: mandamos texto limpio y legible.
    for (const trozo of partirTexto(aTextoPlano(texto, this.canal))) await this.enviar({ to: para, text: trozo });
  }

  // Zavu pide una URL pública del audio (no bytes): lo guardamos en el servidor y le pasamos el enlace.
  async enviarAudio(para: string, audio: Uint8Array, mime: string): Promise<void> {
    if (!this.almacen) throw new Error('Enviar audio requiere PUBLIC_URL en .env');
    const mediaUrl = this.almacen.guardar(audio, mime);
    await this.enviar({ to: para, messageType: 'audio', content: { mediaUrl } });
  }

  // La doc de Zavu no explica cómo bajar un audio entrante. Plan: usar content.mediaUrl del webhook; si no viene,
  // pedirlo con GET /v1/messages/{id}. Si la URL exige autenticación se reintenta con la llave de Zavu.
  // NO VERIFICADO con un mensaje real: si falla, el error dice en qué paso.
  async obtenerAudio(audio: AudioEntrante): Promise<{ datos: Uint8Array; mime: string }> {
    let url = audio.url;
    let mime = audio.mime;
    if (!url && audio.mensajeId) {
      const res = await fetch(`https://api.zavu.dev/v1/messages/${encodeURIComponent(audio.mensajeId)}`, {
        headers: this.cabeceras(),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Zavu no entregó el mensaje ${audio.mensajeId} (${res.status})`);
      const m = (await res.json()) as { message?: { content?: { mediaUrl?: string; mimeType?: string } } };
      url = m.message?.content?.mediaUrl;
      mime ??= m.message?.content?.mimeType;
    }
    if (!url) throw new Error('Zavu no incluyó una URL para el audio entrante (content.mediaUrl); ver "Pendiente" en el README');
    let res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 401 || res.status === 403) {
      res = await fetch(url, { headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(30_000) });
    }
    if (!res.ok) throw new Error(`No se pudo bajar el audio (${res.status})`);
    return { datos: new Uint8Array(await res.arrayBuffer()), mime: mime ?? res.headers.get('content-type') ?? 'audio/ogg' };
  }
}
