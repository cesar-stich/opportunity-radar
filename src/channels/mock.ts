import type { Channel, MensajeEntrante } from '../interfaces';

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
