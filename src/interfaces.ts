// Contratos de todas las integraciones. Cada una tiene implementación `mock` (corre sin llaves)
// y `real`, elegidas por variables de entorno en src/deps.ts.
import type { OportunidadInput } from './types';

// ---------- LLM (cerebro) ----------
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type Mensaje =
  | { role: 'user'; text: string }
  // `raw` guarda la respuesta original del proveedor (p. ej. firmas de pensamiento de Gemini) para reenviarla tal cual.
  | { role: 'assistant'; text?: string; toolCalls?: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: { id: string; name: string; result: unknown }[] };

// JSON Schema simple (subconjunto compatible con Gemini, Groq/OpenAI y Anthropic).
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export type RespuestaLLM = { text?: string; toolCalls?: ToolCall[]; raw?: unknown };

export interface LLMProvider {
  nombre: string;
  chat(req: { system: string; mensajes: Mensaje[]; tools: ToolSpec[] }): Promise<RespuestaLLM>;
}

// ---------- Memoria semántica (AtomicMemory) ----------
export type Recuerdo = { texto: string; meta?: Record<string, string> };

export interface MemoryStore {
  nombre: string;
  guardar(texto: string, meta?: Record<string, string>): Promise<void>;
  buscar(consulta: string, limite?: number): Promise<Recuerdo[]>;
}

// ---------- Canal de mensajería (Zavu: WhatsApp / Telegram) ----------
export type AudioEntrante = { datos?: Uint8Array; url?: string; mime?: string; mensajeId?: string };
export type MensajeEntrante = { de: string; id?: string; texto?: string; audio?: AudioEntrante };

export interface Channel {
  nombre: string;
  // Convierte el webhook del proveedor a un mensaje nuestro (null si no es un mensaje, p. ej. un acuse de entrega).
  recibir(req: Request): Promise<MensajeEntrante | null>;
  enviarTexto(para: string, texto: string): Promise<void>;
  enviarAudio(para: string, audio: Uint8Array, mime: string): Promise<void>;
  // Baja el archivo de una nota de voz entrante (cada proveedor lo entrega distinto). Opcional.
  obtenerAudio?(audio: AudioEntrante): Promise<{ datos: Uint8Array; mime: string }>;
}

// ---------- Voz (ElevenLabs) ----------
export interface Voice {
  nombre: string;
  transcribir(audio: Uint8Array, mime: string): Promise<string>;
  sintetizar(texto: string): Promise<{ audio: Uint8Array; mime: string }>;
}

// ---------- Descubrimiento ----------
// Tavily: búsqueda abierta en la web.
export interface SearchTool {
  nombre: string;
  buscar(consulta: string): Promise<OportunidadInput[]>;
  enriquecer(op: { titulo: string; organizacion: string; url: string }): Promise<string>;
}

// Apify: scraping de portales sin API.
export interface Scraper {
  nombre: string;
  scrapear(fuente: { nombre: string; url: string }): Promise<OportunidadInput[]>;
}
