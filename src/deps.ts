import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crearLLM } from './agent/llm';
import { TelegramChannel } from './channels/telegram';
import { MockChannel, ZavuChannel } from './channels/zavu';
import type { Env } from './config';
import { abrirDb, type DB } from './db/index';
import type { Channel, LLMProvider, MemoryStore, Scraper, SearchTool, Voice } from './interfaces';
import { AtomicMemoryStore, MockMemory } from './memory/atomicmemory';
import { ApifyScraper, MockScraper } from './tools/apify';
import { MockSearch, TavilySearch } from './tools/tavily';
import { PerfilSchema, type Perfil } from './types';
import { AlmacenAudio } from './voice/almacen';
import { ElevenLabsVoice, MockVoice } from './voice/elevenlabs';

// Aquí se decide, según el .env, qué implementación (mock o real) usa cada integración.

export type Deps = {
  env: Env;
  db: DB;
  perfil: Perfil;
  llm: LLMProvider;
  memoria: MemoryStore;
  canal: Channel;
  voz: Voice;
  buscador: SearchTool;
  scraper: Scraper;
  audio: AlmacenAudio;
};

function crearCanalReal(env: Env, audio: AlmacenAudio): Channel {
  const falta = (v: string) => new Error(`CHANNEL=${env.CHANNEL} con ZAVU_MODE=real requiere ${v} en .env`);
  if (!env.ZAVU_API_KEY) throw falta('ZAVU_API_KEY');
  // Sin secreto cualquiera podría falsificar mensajes en el webhook público.
  if (!env.ZAVU_WEBHOOK_SECRET) throw falta('ZAVU_WEBHOOK_SECRET');
  return new ZavuChannel(env.CHANNEL as 'zavu-whatsapp' | 'zavu-telegram', env.ZAVU_API_KEY, env.ZAVU_WEBHOOK_SECRET, env.ZAVU_SENDER_ID, audio);
}

// Telegram directo (sin Zavu): necesario para recibir notas de voz. Ver src/channels/telegram.ts.
function crearTelegram(env: Env): Channel {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('CHANNEL=telegram requiere TELEGRAM_BOT_TOKEN en .env (el de @BotFather)');
  if (!env.TELEGRAM_WEBHOOK_SECRET) throw new Error('CHANNEL=telegram requiere TELEGRAM_WEBHOOK_SECRET en .env (letras, números, _ o -)');
  return new TelegramChannel(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_WEBHOOK_SECRET);
}

export function cargarPerfil(ruta = 'profile.json'): Perfil {
  return PerfilSchema.parse(JSON.parse(readFileSync(ruta, 'utf8')));
}

export function crearDeps(env: Env, extra: Partial<Deps> = {}): Deps {
  // Audios por enviar: junto a la base (en Maritime, /data/audio) o en la carpeta temporal si la base es en memoria.
  const audio =
    extra.audio ?? new AlmacenAudio(env.DB_PATH === ':memory:' ? join(tmpdir(), 'radar-audio') : join(dirname(env.DB_PATH), 'audio'), env.PUBLIC_URL);
  return {
    audio,
    env,
    db: extra.db ?? abrirDb(env.DB_PATH),
    perfil: extra.perfil ?? cargarPerfil(),
    llm: extra.llm ?? crearLLM(env),
    memoria: extra.memoria ?? (env.MEMORY_MODE === 'real' ? new AtomicMemoryStore(env.ATOMICMEMORY_URL ?? 'http://localhost:17350', env.ATOMICMEMORY_API_KEY) : new MockMemory()),
    canal:
      extra.canal ??
      (env.CHANNEL === 'telegram'
        ? crearTelegram(env)
        : env.CHANNEL === 'mock' || env.ZAVU_MODE === 'mock'
          ? new MockChannel()
          : crearCanalReal(env, audio)),
    voz: extra.voz ?? (env.VOICE_MODE === 'real' ? new ElevenLabsVoice(env.ELEVENLABS_API_KEY, env.ELEVENLABS_VOICE_ID) : new MockVoice()),
    buscador: extra.buscador ?? (env.TAVILY_MODE === 'real' ? new TavilySearch(env.TAVILY_API_KEY) : new MockSearch()),
    scraper: extra.scraper ?? (env.APIFY_MODE === 'real' ? new ApifyScraper(env.APIFY_TOKEN) : new MockScraper()),
  };
}
