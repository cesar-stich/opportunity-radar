import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramChannel } from '../src/channels/telegram';
import { FirmaInvalida } from '../src/channels/zavu';

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
