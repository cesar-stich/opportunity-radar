import { z } from 'zod';

// Carga .env si existe (Node 22+). Sin .env todo corre en mock.
try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const modo = z.enum(['mock', 'real']).default('mock');

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DB_PATH: z.string().default('data/radar.db'),
  LLM_PROVIDER: z.enum(['mock', 'gemini', 'groq']).default('mock'),
  LLM_MODEL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  CHANNEL: z.enum(['mock', 'telegram']).default('mock'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // Secreto del webhook de Telegram (solo A-Z, a-z, 0-9, _ y -; 1 a 256 caracteres).
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).optional(),
  // IDs que pueden hablar con el agente (chat id de Telegram), separados por comas.
  ALLOWED_SENDERS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ATOMICMEMORY_URL: z.string().optional(),
  ATOMICMEMORY_API_KEY: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  APIFY_TOKEN: z.string().optional(),
  // URL pública del servidor (Maritime o túnel): con ella se registra el webhook de Telegram al arrancar.
  PUBLIC_URL: z.string().optional(),
  JOBS_TOKEN: z.string().optional(),
  // Protege /ask, /chat y /api/*. En producción (NODE_ENV=production) es obligatorio: la URL pública no tiene login.
  API_TOKEN: z.string().optional(),
  // Solo lectura: lo usa el panel web (Lovable), que lo lleva en el navegador. Acepta GET /api/* y nada más.
  PANEL_TOKEN: z.string().optional(),
  // Si se define, /match exige `Authorization: Bearer <MATCH_TOKEN>` (el que se pone en el ítem de Qatom).
  MATCH_TOKEN: z.string().optional(),
  NODE_ENV: z.string().default('development'),
  NOTIFY_MIN_SCORE: z.coerce.number().default(70),
  VOICE_MODE: modo,
  MEMORY_MODE: modo,
  TAVILY_MODE: modo,
  APIFY_MODE: modo,
  REPLY_AS_VOICE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

// Las variables vacías (`LLM_MODEL=`) cuentan como no definidas.
export function leerEnv(fuente: NodeJS.ProcessEnv = process.env): Env {
  const limpio = Object.fromEntries(Object.entries(fuente).filter(([, v]) => v !== undefined && v.trim() !== ''));
  return EnvSchema.parse(limpio);
}
