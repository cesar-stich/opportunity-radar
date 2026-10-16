import type { LLMProvider, Mensaje, RespuestaLLM, ToolSpec } from '../../interfaces';

// Anthropic (DE PAGO, opcional: no activar con presupuesto cero). Messages API con tool use.

type Bloque = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export class AnthropicLLM implements LLMProvider {
  nombre = 'anthropic';
  constructor(
    private apiKey: string,
    private modelo = 'claude-haiku-5-5',
  ) {}

  async chat({ system, mensajes, tools }: { system: string; mensajes: Mensaje[]; tools: ToolSpec[] }): Promise<RespuestaLLM> {
    const messages = mensajes.map((m) => {
      if (m.role === 'user') return { role: 'user', content: m.text };
      if (m.role === 'assistant')
        return {
          role: 'assistant',
          content: [
            ...(m.text ? [{ type: 'text', text: m.text }] : []),
            ...(m.toolCalls ?? []).map((tc) => ({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args })),
          ],
        };
      return {
        role: 'user',
        content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.result) })),
      };
    });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: this.modelo,
        max_tokens: 1024,
        system,
        messages,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`);

    const data = (await res.json()) as { content: Bloque[] };
    const text = data.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('') || undefined;
    const toolCalls = data.content
      .filter((b): b is Extract<Bloque, { type: 'tool_use' }> => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: b.input }));
    return { text, toolCalls };
  }
}
