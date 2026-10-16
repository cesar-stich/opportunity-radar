import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/app';
import { FirmaInvalida, partirTexto, verificarFirma, ZavuChannel } from '../src/channels/zavu';
import { MockLLM } from '../src/agent/providers/mock';
import { leerEnv } from '../src/config';
import { abrirDb } from '../src/db/index';
import { crearDeps } from '../src/deps';
import { MockMemory } from '../src/memory/atomicmemory';
import { aTextoPlano } from '../src/util/formato';
import { depsDePrueba } from './helpers';

const SECRETO = 'whsec_prueba';
const firmar = (cuerpo: string, t = Math.floor(Date.now() / 1000), v: 'v1' | 'v2' = 'v2') =>
  `t=${t},${v}=${createHmac('sha256', SECRETO).update(v === 'v2' ? `${t}.${cuerpo}` : cuerpo).digest('hex')}`;

const evento = (texto: string, extra: Record<string, unknown> = {}, id = 'msg_1') =>
  JSON.stringify({
    id: `evt_${id}`,
    type: 'message.inbound',
    timestamp: Date.now(),
    senderId: 'snd_1',
    data: { messageId: id, from: '123456789', to: 'bot', channel: 'telegram', messageType: 'text', text: texto, ...extra },
  });

const webhook = (cuerpo: string, firma: string | null) =>
  new Request('http://local/webhook/zavu', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(firma ? { 'x-zavu-signature': firma } : {}) },
    body: cuerpo,
  });

const cuerpoDe = (llamada: unknown) => JSON.parse(String((llamada as [string, RequestInit])[1].body));

describe('firma del webhook (X-Zavu-Signature)', () => {
  const cuerpo = '{"a":1}';
  it('acepta v2 (t.cuerpo) y v1 (solo cuerpo)', () => {
    expect(() => verificarFirma(SECRETO, cuerpo, firmar(cuerpo))).not.toThrow();
    expect(() => verificarFirma(SECRETO, cuerpo, firmar(cuerpo, undefined, 'v1'))).not.toThrow();
  });
  it('rechaza cuerpo alterado, secreto distinto, sin cabecera y fuera de ventana', () => {
    expect(() => verificarFirma(SECRETO, '{"a":2}', firmar(cuerpo))).toThrow(FirmaInvalida);
    expect(() => verificarFirma('otro', cuerpo, firmar(cuerpo))).toThrow(FirmaInvalida);
    expect(() => verificarFirma(SECRETO, cuerpo, null)).toThrow(FirmaInvalida);
    const hace10min = Math.floor(Date.now() / 1000) - 600;
    expect(() => verificarFirma(SECRETO, cuerpo, firmar(cuerpo, hace10min))).toThrow(/ventana/);
    const futuro = Math.floor(Date.now() / 1000) + 120;
    expect(() => verificarFirma(SECRETO, cuerpo, firmar(cuerpo, futuro))).toThrow(/ventana/);
  });
});

describe('ZavuChannel (sin red)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const canal = () => new ZavuChannel('zavu-telegram', 'zv_test_x', SECRETO, 'snd_1');

  it('convierte message.inbound en mensaje y ignora acuses y otros tipos', async () => {
    const c = canal();
    const cuerpo = evento('hola radar');
    expect(await c.recibir(webhook(cuerpo, firmar(cuerpo)))).toEqual({ de: '123456789', id: 'msg_1', texto: 'hola radar' });
    const acuse = JSON.stringify({ type: 'message.delivered', data: { from: '1' } });
    expect(await c.recibir(webhook(acuse, firmar(acuse)))).toBeNull();
    const foto = evento('', { messageType: 'image', text: undefined });
    expect(await c.recibir(webhook(foto, firmar(foto)))).toBeNull();
    const voz = evento('', { messageType: 'audio', text: undefined, content: { mimeType: 'audio/ogg' } });
    expect(await c.recibir(webhook(voz, firmar(voz)))).toMatchObject({ de: '123456789', audio: { mime: 'audio/ogg' } });
  });

  it('exige firma válida', async () => {
    await expect(canal().recibir(webhook(evento('hola'), 't=1,v2=00'))).rejects.toThrow(FirmaInvalida);
  });

  it('envía por /v1/messages con Bearer, sender y canal telegram, en texto limpio', async () => {
    const fetchFalso = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchFalso);
    await canal().enviarTexto('123456789', '**Hola** [Ver link](https://x.pe/a)');
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.zavu.dev/v1/messages');
    expect(init.headers).toMatchObject({ authorization: 'Bearer zv_test_x', 'zavu-sender': 'snd_1' });
    expect(cuerpoDe(fetchFalso.mock.calls[0])).toEqual({ to: '123456789', text: 'Hola Ver link: https://x.pe/a', channel: 'telegram' });
  });

  it('parte los mensajes largos y propaga los errores de Zavu', async () => {
    const fetchFalso = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchFalso);
    await canal().enviarTexto('1', 'palabra '.repeat(1000));
    expect(fetchFalso.mock.calls.length).toBeGreaterThan(1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"blocked"}', { status: 403 })));
    await expect(canal().enviarTexto('1', 'hola')).rejects.toThrow(/Zavu 403/);
  });

  it('WhatsApp usa *negrita* y channel whatsapp', async () => {
    const fetchFalso = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchFalso);
    await new ZavuChannel('zavu-whatsapp', 'zv_test_x', SECRETO).enviarTexto('+51999999999', '**Hola**');
    expect(cuerpoDe(fetchFalso.mock.calls[0])).toMatchObject({ text: '*Hola*', channel: 'whatsapp' });
  });
});

describe('configuración del canal real', () => {
  const crear = (vars: Record<string, string>) =>
    crearDeps(leerEnv({ CHANNEL: 'zavu-telegram', ZAVU_MODE: 'real', ...vars }), { db: abrirDb(':memory:'), llm: new MockLLM(), memoria: new MockMemory() });

  it('exige llave y secreto del webhook; sin ellos no arranca', () => {
    expect(() => crear({ ZAVU_WEBHOOK_SECRET: 's' })).toThrow(/ZAVU_API_KEY/);
    expect(() => crear({ ZAVU_API_KEY: 'zv_test_x' })).toThrow(/ZAVU_WEBHOOK_SECRET/);
    expect(crear({ ZAVU_API_KEY: 'zv_test_x', ZAVU_WEBHOOK_SECRET: 's' }).canal.nombre).toBe('zavu-telegram');
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
    expect(aTextoPlano('* uno\n- dos\n**[68/100]** [Ver](https://a.pe)', 'telegram')).toBe('• uno\n• dos\n[68/100] Ver: https://a.pe');
  });
});

// El flujo completo: webhook firmado → agente → respuesta enviada por el canal.
describe('webhook /webhook/zavu', () => {
  afterEach(() => vi.unstubAllGlobals());

  function montar(permitidos = '123456789') {
    const env = leerEnv({ JOBS_TOKEN: 'secreto', ALLOWED_SENDERS: permitidos });
    const enviados: { to: string; text: string; channel: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        enviados.push(JSON.parse(String(init.body)));
        return new Response('{}', { status: 202 });
      }),
    );
    const deps = depsDePrueba({ env, canal: new ZavuChannel('zavu-telegram', 'zv_test_x', SECRETO) });
    return { app: crearApp(deps), enviados, deps };
  }
  const enviar = (app: ReturnType<typeof crearApp>, cuerpo: string, firma: string | null = firmar(cuerpo)) => app.fetch(webhook(cuerpo, firma));

  it('un mensaje del dueño llega al agente y la respuesta sale por Zavu', async () => {
    const { app, enviados } = montar();
    expect((await enviar(app, evento('¿qué hay para becas?'))).status).toBe(200);
    await app.mensajeria.inactivo();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ to: '123456789', channel: 'telegram' });
    expect(enviados[0].text).toMatch(/\[\d+\/100\]/);
  });

  it('firma inválida: 401 y el agente no se entera', async () => {
    const { app, enviados } = montar();
    expect((await enviar(app, evento('hola'), 't=1,v2=00')).status).toBe(401);
    expect((await enviar(app, evento('hola'), null)).status).toBe(401);
    await app.mensajeria.inactivo();
    expect(enviados).toHaveLength(0);
  });

  it('los reintentos de Zavu (mismo messageId) se atienden una sola vez', async () => {
    const { app, enviados } = montar();
    const cuerpo = evento('hola', {}, 'msg_dup');
    await enviar(app, cuerpo);
    await enviar(app, cuerpo);
    await app.mensajeria.inactivo();
    expect(enviados).toHaveLength(1);
  });

  it('un remitente desconocido no usa el agente', async () => {
    const { app, enviados, deps } = montar('999');
    await enviar(app, evento('busca prácticas en Lima'));
    await app.mensajeria.inactivo();
    expect(enviados).toHaveLength(1);
    expect(enviados[0].text).toBe('Este agente es privado.');
    expect(deps.db.prepare('SELECT COUNT(*) n FROM oportunidades').get()).toEqual({ n: 15 });
  });

  it('sin dueño configurado, el bot le dice su ID para que lo configure', async () => {
    const { app, enviados } = montar('');
    await enviar(app, evento('hola'));
    await app.mensajeria.inactivo();
    expect(enviados[0].text).toMatch(/Tu ID es 123456789.*ALLOWED_SENDERS/);
  });

  it('acuses de entrega y audios no rompen nada', async () => {
    const { app, enviados } = montar();
    const acuse = JSON.stringify({ type: 'message.delivered', data: { from: '123456789' } });
    expect((await enviar(app, acuse)).status).toBe(200);
    await enviar(app, evento('', { messageType: 'audio', text: undefined }, 'msg_voz'));
    await app.mensajeria.inactivo();
    expect(enviados).toHaveLength(1);
    expect(enviados[0].text).toMatch(/notas de voz/);
  });

  it('si Zavu falla al responder, el servidor sigue vivo', async () => {
    const { app } = montar();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await enviar(app, evento('hola', {}, 'msg_fallo'))).status).toBe(200);
    await expect(app.mensajeria.inactivo()).resolves.toBeUndefined();
  });
});
