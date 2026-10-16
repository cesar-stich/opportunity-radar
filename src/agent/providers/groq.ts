import type { LLMProvider, Mensaje, RespuestaLLM, ToolSpec } from '../../interfaces';

// Groq (capa gratuita) vía su API compatible con OpenAI (chat/completions + tools).
// Docs: https://console.groq.com/docs/tool-use

type ToolCallOpenAI = { id: string; type: 'function'; function: { name: string; arguments: string } };

export class GroqLLM implements LLMProvider {
  nombre = 'groq';
  constructor(
    private apiKey: string,
    private modelo = 'openai/gpt-oss-120b',
  ) {}

  async chat({ system, mensajes, tools }: { system: string; mensajes: Mensaje[]; tools: ToolSpec[] }): Promise<RespuestaLLM> {
    const messages: Record<string, unknown>[] = [{ role: 'system', content: system }];
    for (const m of mensajes) {
      if (m.role === 'user') messages.push({ role: 'user', content: m.text });
      else if (m.role === 'assistant')
        messages.push({
          role: 'assistant',
          content: m.text ?? null,
          ...(m.toolCalls?.length && {
            tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })),
          }),
        });
      else for (const r of m.results) messages.push({ role: 'tool', tool_call_id: r.id, name: r.name, content: JSON.stringify(r.result) });
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.modelo,
        messages,
        tools: tools.map((t) => ({ type: 'function', function: t })),
        tool_choice: 'auto',
      }),
    });
    if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 500)}`);

    const data = (await res.json()) as { choices: { message: { content?: string | null; tool_calls?: ToolCallOpenAI[] } }[] };
    const msg = data.choices[0].message;
    const toolCalls = (msg.tool_calls ?? []).map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        /* argumentos mal formados: la herramienta los rechazará con un error legible */
      }
      return { id: tc.id, name: tc.function.name, args };
    });
    return { text: msg.content ?? undefined, toolCalls };
  }
}
