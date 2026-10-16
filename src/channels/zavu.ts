import type { Channel, MensajeEntrante } from '../interfaces';

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

// Real: pendiente Fase 4 (leer docs de Zavu: sandbox, plantillas para mensajes proactivos, firma del webhook).
export class ZavuChannel implements Channel {
  constructor(
    public nombre: 'zavu-whatsapp' | 'zavu-telegram',
    private apiKey?: string,
    private webhookSecret?: string,
  ) {}

  async recibir(): Promise<MensajeEntrante | null> {
    throw new Error('Zavu real: pendiente Fase 4 (usa CHANNEL=mock)');
  }
  async enviarTexto(): Promise<void> {
    throw new Error('Zavu real: pendiente Fase 4 (usa CHANNEL=mock)');
  }
  async enviarAudio(): Promise<void> {
    throw new Error('Zavu real: pendiente Fase 4 (usa CHANNEL=mock)');
  }
}
