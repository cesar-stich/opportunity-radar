import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/app';
import { crearAgente } from '../src/agent/agent';
import { ZavuChannel } from '../src/channels/zavu';
import { leerEnv } from '../src/config';
import type { AudioEntrante, Channel, MensajeEntrante } from '../src/interfaces';
import { crearMensajeria } from '../src/mensajeria';
import { resumenSemanal } from '../src/jobs';
import { textoParaVoz } from '../src/util/voz';
import { AlmacenAudio } from '../src/voice/almacen';
import { ElevenLabsVoice, MockVoice } from '../src/voice/elevenlabs';
import { depsDePrueba } from './helpers';

const bytes = (t: string) => new TextEncoder().encode(t);

describe('textoParaVoz', () => {
  it('quita enlaces, emojis y símbolos, y lee los puntajes', () => {
    const t = textoParaVoz('📡 Encontré 1:\n1. [85/100] Beca de IA — Acme (cierra 2026-10-30)\n   https://acme.pe/beca');
    expect(t).not.toMatch(/https|📡|\[|\]/);
    expect(t).toMatch(/85 de 100/);
  });
  it('acorta lo largo sin cortar a mitad de frase', () => {
    const t = textoParaVoz('Frase de prueba número uno. '.repeat(100), 200);
    expect(t.length).toBeLessThan(260);
    expect(t).toMatch(/Lo demás te lo dejo por escrito\.$/);
  });
});

describe('ElevenLabs (sin red)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('transcribe con multipart, scribe_v2 y xi-api-key', async () => {
    const f = vi.fn(async () => Response.json({ text: ' hola radar ' }));
    vi.stubGlobal('fetch', f);
    expect(await new ElevenLabsVoice('xi_test', 'voz1').transcribir(bytes('audio'), 'audio/ogg')).toBe('hola radar');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('xi_test');
    const form = init.body as FormData;
    expect(form.get('model_id')).toBe('scribe_v2');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('sintetiza con la voz elegida y devuelve mp3', async () => {
    const f = vi.fn(async () => new Response(bytes('mp3-falso'), { headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', f);
    const r = await new ElevenLabsVoice('xi_test', 'voz1').sintetizar('Hola');
    expect(r.mime).toBe('audio/mpeg');
    expect(new TextDecoder().decode(r.audio)).toBe('mp3-falso');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voz1?output_format=mp3_44100_64');
    expect(JSON.parse(String(init.body))).toEqual({ text: 'Hola', model_id: 'eleven_multilingual_v2' });
  });

  it('falla con mensajes claros sin llave, sin voz o sin créditos', async () => {
    await expect(new ElevenLabsVoice().transcribir(bytes('x'), 'audio/ogg')).rejects.toThrow(/ELEVENLABS_API_KEY/);
    await expect(new ElevenLabsVoice('k').sintetizar('x')).rejects.toThrow(/ELEVENLABS_VOICE_ID/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota', { status: 429 })));
    await expect(new ElevenLabsVoice('k', 'v').sintetizar('x')).rejects.toThrow(/sin créditos/);
  });
});

describe('AlmacenAudio', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-test-audio-'));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('guarda con nombre aleatorio, devuelve la URL pública y solo sirve nombres válidos', () => {
    const a = new AlmacenAudio(dir, 'https://radar.example.app/');
    const url = a.guardar(bytes('mp3'), 'audio/mpeg');
    expect(url).toMatch(/^https:\/\/radar\.example\.app\/audio\/[a-f0-9]{32}\.mp3$/);
    const archivo = url.split('/').pop()!;
    expect(a.leer(archivo)?.mime).toBe('audio/mpeg');
    expect(a.leer('../../.env')).toBeNull();
    expect(a.leer('0'.repeat(32) + '.mp3')).toBeNull();
  });
  it('sin PUBLIC_URL no guarda', () => {
    expect(() => new AlmacenAudio(dir).guardar(bytes('x'), 'audio/mpeg')).toThrow(/PUBLIC_URL/);
  });
});

describe('Zavu: audio (sin red)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const dir = mkdtempSync(join(tmpdir(), 'radar-test-audio2-'));
  const canal = () => new ZavuChannel('zavu-telegram', 'zv_test_x', 's', 'snd_1', new AlmacenAudio(dir, 'https://radar.example.app'));

  it('envía el audio como URL pública (messageType audio + content.mediaUrl)', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', f);
    await canal().enviarAudio('123', bytes('mp3'), 'audio/mpeg');
    const cuerpo = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(cuerpo).toMatchObject({ to: '123', channel: 'telegram', messageType: 'audio' });
    expect(cuerpo.content.mediaUrl).toMatch(/^https:\/\/radar\.example\.app\/audio\/[a-f0-9]{32}\.mp3$/);
  });

  it('baja el audio entrante con la URL del webhook, o con GET /v1/messages/{id} si no vino', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes('/v1/messages/')) return Response.json({ message: { content: { mediaUrl: 'https://cdn.example/voz.ogg', mimeType: 'audio/ogg' } } });
      return new Response(bytes('ogg-bytes'), { headers: { 'content-type': 'audio/ogg' } });
    });
    vi.stubGlobal('fetch', f);
    const a1 = await canal().obtenerAudio({ url: 'https://cdn.example/directo.ogg', mime: 'audio/ogg' });
    expect(new TextDecoder().decode(a1.datos)).toBe('ogg-bytes');
    const a2 = await canal().obtenerAudio({ mensajeId: 'msg_9' });
    expect(a2.mime).toBe('audio/ogg');
    expect(String((f.mock.calls.at(-2) as unknown as [string])[0])).toContain('/v1/messages/msg_9');
  });

  it('reintenta con la llave de Zavu si la URL exige autenticación', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) =>
      (init?.headers as Record<string, string> | undefined)?.authorization ? new Response(bytes('ok')) : new Response('no', { status: 403 }),
    );
    vi.stubGlobal('fetch', f);
    expect(new TextDecoder().decode((await canal().obtenerAudio({ url: 'https://cdn.example/x.ogg', mime: 'audio/ogg' })).datos)).toBe('ok');
  });

  it('sin URL en el webhook ni en el mensaje, explica qué falta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: { content: {} } })));
    await expect(canal().obtenerAudio({ mensajeId: 'm' })).rejects.toThrow(/no incluyó una URL/);
  });
});

// Canal falso: guarda lo que se le envía y entrega el audio entrante tal cual.
function canalFalso() {
  const enviados: { texto?: string; audio?: string }[] = [];
  const canal: Channel = {
    nombre: 'falso',
    recibir: async () => null,
    enviarTexto: async (_p, texto) => void enviados.push({ texto }),
    enviarAudio: async (_p, audio) => void enviados.push({ audio: new TextDecoder().decode(audio) }),
    obtenerAudio: async (a: AudioEntrante) => ({ datos: a.datos ?? bytes(''), mime: a.mime ?? 'audio/ogg' }),
  };
  return { canal, enviados };
}

describe('nota de voz → agente → respuesta', () => {
  const nota = (texto: string, id: string): MensajeEntrante => ({ de: '1', id, audio: { datos: bytes(texto), mime: 'audio/ogg' } });
  const montar = (responderEnVoz: boolean) => {
    const deps = depsDePrueba();
    const { canal, enviados } = canalFalso();
    const m = crearMensajeria({ canal, agente: crearAgente(deps), permitidos: ['1'], voz: new MockVoice(), responderEnVoz });
    return { m, enviados };
  };

  it('con REPLY_AS_VOICE=false: transcribe y responde por texto mostrando lo que entendió', async () => {
    const { m, enviados } = montar(false);
    await m.procesar(nota('¿qué hay para becas?', 'a1'));
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toMatch(/Te escuché: «¿qué hay para becas\?»/);
    expect(enviados[0].texto).toMatch(/\[\d+\/100\]/);
  });

  it('con REPLY_AS_VOICE=true: responde en audio (sin enlaces ni emojis)', async () => {
    const { m, enviados } = montar(true);
    await m.procesar(nota('¿qué hay para becas?', 'a2'));
    expect(enviados).toHaveLength(1);
    expect(enviados[0].audio).toMatch(/de 100/);
    expect(enviados[0].audio).not.toMatch(/https?:/);
  });

  it('si el audio de respuesta falla, responde por texto', async () => {
    const { canal, enviados } = canalFalso();
    canal.enviarAudio = async () => Promise.reject(new Error('PUBLIC_URL falta'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = crearMensajeria({ canal, agente: crearAgente(depsDePrueba()), permitidos: ['1'], voz: new MockVoice(), responderEnVoz: true });
    await m.procesar(nota('¿qué hay para becas?', 'a3'));
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toMatch(/Te escuché/);
  });

  it('un audio vacío o que no se puede transcribir avisa y no llama al agente', async () => {
    const { m, enviados } = montar(false);
    await m.procesar(nota('', 'a4'));
    expect(enviados[0].texto).toMatch(/No te entendí/);
  });

  it('un texto normal sigue respondiendo por texto aunque REPLY_AS_VOICE esté activo', async () => {
    const { m, enviados } = montar(true);
    await m.procesar({ de: '1', id: 't1', texto: '¿qué hay para becas?' });
    expect(enviados[0].texto).toMatch(/\[\d+\/100\]/);
    expect(enviados[0].audio).toBeUndefined();
  });
});

describe('resumen semanal en audio y /audio', () => {
  it('con REPLY_AS_VOICE manda texto y audio; si el audio falla, avisa pero el job sigue ok', async () => {
    const { canal, enviados } = canalFalso();
    const env = leerEnv({ ALLOWED_SENDERS: '1', REPLY_AS_VOICE: 'true' });
    const deps = depsDePrueba({ env, canal, voz: new MockVoice() });
    const agente = crearAgente(deps);
    const r = await resumenSemanal(deps, agente);
    expect(r.ok).toBe(true);
    expect(enviados.map((e) => (e.texto ? 'texto' : 'audio'))).toEqual(['texto', 'audio']);

    canal.enviarAudio = async () => Promise.reject(new Error('sin PUBLIC_URL'));
    const r2 = await resumenSemanal(deps, agente);
    expect(r2.ok).toBe(true);
    expect(r2.errores?.[0]).toMatch(/audio: sin PUBLIC_URL/);
  });

  it('GET /audio/:archivo sirve solo lo guardado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'radar-test-audio3-'));
    const audio = new AlmacenAudio(dir, 'https://x.app');
    const app = crearApp(depsDePrueba({ audio }));
    const archivo = audio.guardar(bytes('datos'), 'audio/mpeg').split('/').pop()!;
    const ok = await app.request(`/audio/${archivo}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('audio/mpeg');
    expect((await app.request('/audio/nada.mp3')).status).toBe(404);
    rmSync(dir, { recursive: true, force: true });
  });
});
