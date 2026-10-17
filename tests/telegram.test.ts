import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/app';
import { leerEnv } from '../src/config';
import { aTextoPlano } from '../src/util/formato';
import { depsDePrueba } from './helpers';
import { FirmaInvalida, partirTexto, TelegramChannel } from '../src/channels/telegram';

const SECRETO = 'secreto_de_prueba-1';
const canal = () => new TelegramChannel('123:TOKEN', SECRETO);

const update = (message: Record<string, unknown>, secreto: string | null = SECRETO) =>
  new Request('http://local/webhook/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secreto ? { 'x-telegram-bot-api-secret-token': secreto } : {}) },
    body: JSON.stringify({ update_id: 77, message: { message_id: 1, chat: { id: 8859077645, type: 'private' }, ...message } }),
  });

afterEach(() => vi.unstubAllGlobals());

describe('TelegramChannel.recibir', () => {
  it('texto: devuelve chat id numérico y update_id como id', async () => {
    expect(await canal().recibir(update({ text: ' hola ' }))).toEqual({ de: '8859077645', id: '77', texto: 'hola' });
  });

  it('nota de voz: devuelve el file_id para bajarla después', async () => {
    const m = await canal().recibir(update({ voice: { file_id: 'AwAC_x', mime_type: 'audio/ogg' } }));
    expect(m).toEqual({ de: '8859077645', id: '77', audio: { mensajeId: 'AwAC_x', mime: 'audio/ogg' } });
  });

  it('rechaza si falta o es incorrecto el secreto', async () => {
    await expect(canal().recibir(update({ text: 'hola' }, null))).rejects.toBeInstanceOf(FirmaInvalida);
    await expect(canal().recibir(update({ text: 'hola' }, 'otro'))).rejects.toBeInstanceOf(FirmaInvalida);
  });

  it('ignora lo que no es texto ni audio (fotos, etc.)', async () => {
    expect(await canal().recibir(update({ photo: [{ file_id: 'x' }] }))).toBeNull();
  });
});

describe('TelegramChannel envío y descarga', () => {
  it('enviarTexto manda sendMessage con el chat id y texto plano', async () => {
    const f = vi.fn(async () => Response.json({ ok: true, result: {} }));
    vi.stubGlobal('fetch', f);
    await canal().enviarTexto('8859077645', 'Hola **Cesar**');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:TOKEN/sendMessage');
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: '8859077645', text: 'Hola Cesar' });
  });

  it('enviarAudio: mp3 va por sendAudio y ogg por sendVoice (bytes, sin URL pública)', async () => {
    const f = vi.fn(async () => Response.json({ ok: true, result: {} }));
    vi.stubGlobal('fetch', f);
    await canal().enviarAudio('1', new Uint8Array([1, 2, 3]), 'audio/mpeg');
    await canal().enviarAudio('1', new Uint8Array([1, 2, 3]), 'audio/ogg');
    expect((f.mock.calls[0] as unknown as [string])[0]).toMatch(/\/sendAudio$/);
    expect((f.mock.calls[1] as unknown as [string])[0]).toMatch(/\/sendVoice$/);
    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData).get('chat_id')).toBe('1');
  });

  it('obtenerAudio: getFile y luego descarga desde /file/bot…', async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith('/getFile') ? Response.json({ ok: true, result: { file_path: 'voice/file_0.oga' } }) : new Response(new Uint8Array([9, 8, 7])),
    );
    vi.stubGlobal('fetch', f);
    const r = await canal().obtenerAudio({ mensajeId: 'AwAC_x', mime: 'audio/ogg' });
    expect(Array.from(r.datos)).toEqual([9, 8, 7]);
    expect(r.mime).toBe('audio/ogg');
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe('https://api.telegram.org/file/bot123:TOKEN/voice/file_0.oga');
  });

  it('registrarWebhook manda url, secret_token y solo mensajes', async () => {
    const f = vi.fn(async () => Response.json({ ok: true, result: true }));
    vi.stubGlobal('fetch', f);
    await canal().registrarWebhook('https://x.trycloudflare.com/');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/setWebhook$/);
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://x.trycloudflare.com/webhook/telegram', secret_token: SECRETO, allowed_updates: ['message'] });
  });

  it('un error de Telegram se propaga con su descripción', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, description: 'chat not found' }, { status: 400 })));
    await expect(canal().enviarTexto('1', 'x')).rejects.toThrow(/chat not found/);
  });
});

describe('utilidades de texto', () => {
  it('partirTexto respeta el máximo y no pierde contenido', () => {
    const texto = Array.from({ length: 300 }, (_, i) => `línea ${i}`).join('\n');
    const trozos = partirTexto(texto, 500);
    expect(trozos.every((t) => t.length <= 500)).toBe(true);
    expect(trozos.join('\n').replace(/\s+/g, ' ')).toBe(texto.replace(/\s+/g, ' '));
  });
  it('aTextoPlano convierte viñetas y enlaces', () => {
    expect(aTextoPlano('* uno\n- dos\n**[68/100]** [Ver](https://a.pe)')).toBe('• uno\n• dos\n[68/100] Ver: https://a.pe');
  });
});

// El flujo completo: webhook con secreto → agente → respuesta enviada por Telegram.
describe('webhook /webhook/telegram', () => {
  function montar(permitidos = '8859077645') {
    const env = leerEnv({ JOBS_TOKEN: 'secreto', ALLOWED_SENDERS: permitidos });
    const enviados: { chat_id: string; text: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        enviados.push(JSON.parse(String(init.body)));
        return Response.json({ ok: true, result: {} });
      }),
    );
    return { app: crearApp(depsDePrueba({ env, canal: canal() })), enviados };
  }
  const enviar = (app: ReturnType<typeof crearApp>, message: Record<string, unknown>, secreto: string | null = SECRETO) => app.fetch(update(message, secreto));

  it('un mensaje del dueño llega al agente y la respuesta sale por Telegram', async () => {
    const { app, enviados } = montar();
    expect((await enviar(app, { text: '¿qué hay para becas?' })).status).toBe(200);
    await app.mensajeria.inactivo();
    expect(enviados).toHaveLength(1);
    expect(enviados[0].chat_id).toBe('8859077645');
    expect(enviados[0].text).toMatch(/\[\d+\/100\]/);
  });

  it('secreto inválido: 401 y el agente no se entera', async () => {
    const { app, enviados } = montar();
    expect((await enviar(app, { text: 'hola' }, 'otro')).status).toBe(401);
    expect((await enviar(app, { text: 'hola' }, null)).status).toBe(401);
    await app.mensajeria.inactivo();
    expect(enviados).toHaveLength(0);
  });

  it('un remitente desconocido no usa el agente', async () => {
    const { app, enviados } = montar('999');
    await enviar(app, { text: 'busca prácticas en Lima' });
    await app.mensajeria.inactivo();
    expect(enviados).toHaveLength(1);
    expect(enviados[0].text).toBe('Este agente es privado.');
  });

  it('sin dueño configurado, el bot le dice su ID', async () => {
    const { app, enviados } = montar('');
    await enviar(app, { text: 'hola' });
    await app.mensajeria.inactivo();
    expect(enviados[0].text).toMatch(/Tu ID es 8859077645.*ALLOWED_SENDERS/);
  });

  it('si Telegram falla al responder, el servidor sigue vivo', async () => {
    const { app } = montar();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, description: 'boom' }, { status: 500 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await enviar(app, { text: 'hola' })).status).toBe(200);
    await expect(app.mensajeria.inactivo()).resolves.toBeUndefined();
  });
});
