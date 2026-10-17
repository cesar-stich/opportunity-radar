import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearAgente } from '../src/agent/agent';
import { leerEnv } from '../src/config';
import type { AudioEntrante, Channel, MensajeEntrante } from '../src/interfaces';
import { crearMensajeria } from '../src/mensajeria';
import { resumenSemanal } from '../src/jobs';
import { textoParaVoz } from '../src/util/voz';
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

describe('resumen semanal en audio', () => {
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
});
