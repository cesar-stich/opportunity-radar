import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Zavu no acepta bytes para enviar audio: pide una URL pública HTTPS que siga viva ≥ 24 h (doc de audio de WhatsApp).
// Así que guardamos el mp3 en disco con un nombre aleatorio (128 bits: imposible de adivinar) y lo servimos en /audio/:archivo.
// Solo tiene sentido con PUBLIC_URL (la URL de Maritime o del túnel).

const EXTENSION: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };
const MIME: Record<string, string> = { mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4' };
const VIDA_MS = 72 * 3600_000; // más que las 24 h que exige Zavu
export const PATRON_ARCHIVO = /^[a-f0-9]{32}\.(mp3|ogg|m4a)$/;

export class AlmacenAudio {
  constructor(
    private dir: string,
    private urlPublica?: string,
  ) {}

  guardar(datos: Uint8Array, mime: string): string {
    if (!this.urlPublica) throw new Error('Enviar audio requiere PUBLIC_URL en .env (la URL pública del servidor)');
    mkdirSync(this.dir, { recursive: true });
    this.limpiar();
    const archivo = `${randomBytes(16).toString('hex')}.${EXTENSION[mime] ?? 'mp3'}`;
    writeFileSync(join(this.dir, archivo), datos);
    return `${this.urlPublica.replace(/\/+$/, '')}/audio/${archivo}`;
  }

  leer(archivo: string): { datos: Buffer; mime: string } | null {
    if (!PATRON_ARCHIVO.test(archivo)) return null; // también evita "../"
    try {
      return { datos: readFileSync(join(this.dir, archivo)), mime: MIME[archivo.split('.')[1]] };
    } catch {
      return null;
    }
  }

  private limpiar() {
    try {
      for (const f of readdirSync(this.dir)) {
        const ruta = join(this.dir, f);
        if (Date.now() - statSync(ruta).mtimeMs > VIDA_MS) unlinkSync(ruta);
      }
    } catch {
      /* limpiar es opcional */
    }
  }
}
