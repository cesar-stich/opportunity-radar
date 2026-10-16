import type { Env } from '../config';
import type { LLMProvider } from '../interfaces';
import { AnthropicLLM } from './providers/anthropic';
import { GeminiLLM } from './providers/gemini';
import { GroqLLM } from './providers/groq';
import { MockLLM } from './providers/mock';

export type { LLMProvider } from '../interfaces';

// El cerebro es intercambiable: LLM_PROVIDER elige el proveedor y LLM_MODEL el modelo.
export function crearLLM(env: Env): LLMProvider {
  const falta = (llave: string) => new Error(`LLM_PROVIDER=${env.LLM_PROVIDER} requiere ${llave} en .env`);
  switch (env.LLM_PROVIDER) {
    case 'gemini':
      if (!env.GEMINI_API_KEY) throw falta('GEMINI_API_KEY');
      return new GeminiLLM(env.GEMINI_API_KEY, env.LLM_MODEL);
    case 'groq':
      if (!env.GROQ_API_KEY) throw falta('GROQ_API_KEY');
      return new GroqLLM(env.GROQ_API_KEY, env.LLM_MODEL);
    case 'anthropic':
      if (!env.ANTHROPIC_API_KEY) throw falta('ANTHROPIC_API_KEY');
      return new AnthropicLLM(env.ANTHROPIC_API_KEY, env.LLM_MODEL);
    default:
      return new MockLLM();
  }
}
