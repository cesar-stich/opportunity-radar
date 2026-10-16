import type { LLMProvider, Mensaje, RespuestaLLM, ToolSpec } from '../../interfaces';

// Gemini (Google AI Studio, capa gratuita) vía REST generateContent con function calling.
// Docs: https://ai.google.dev/api/generate-content y https://ai.google.dev/gemini-api/docs/function-calling
// Gemini 3 devuelve "thought signatures" dentro de las partes: por eso reenviamos el `content` original (raw) tal cual.

type Part = { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: Record<string, unknown> } };
type Content = { role: 'user' | 'model'; parts: Part[] | Record<string, unknown>[] };

export class GeminiLLM implements LLMProvider {
  nombre = 'gemini';
  constructor(
    private apiKey: string,
    private modelo = 'gemini-3.8-flash',
  ) {}

  async chat({ system, mensajes, tools }: { system: string; mensajes: Mensaje[]; tools: ToolSpec[] }): Promise<RespuestaLLM> {
    const contents: Content[] = mensajes.map((m) => {
      if (m.role === 'user') return { role: 'user', parts: [{ text: m.text }] };
      if (m.role === 'assistant')
        return (m.raw as Content) ?? {
          role: 'model',
          parts: [...(m.text ? [{ text: m.text }] : []), ...(m.toolCalls ?? []).map((tc) => ({ functionCall: { name: tc.name, args: tc.args } }))],
        };
      return { role: 'user', parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: { result: r.result } } })) };
    });

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.modelo}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: tools }],
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 500)}`);

    const data = (await res.json()) as { candidates?: { content?: Content }[] };
    const content: Content = data.candidates?.[0]?.content ?? { role: 'model', parts: [] };
    const parts = (content.parts ?? []) as Part[];
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('') || undefined;
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({ id: p.functionCall!.id ?? `${p.functionCall!.name}-${i}`, name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
    return { text, toolCalls, raw: content };
  }
}
