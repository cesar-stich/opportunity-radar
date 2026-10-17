// El LLM responde con Markdown (**negrita**, [texto](url)); Telegram lo recibe como texto plano
// (evita errores de formato con símbolos como _ o [ ] en los títulos).
export function aTextoPlano(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2') // [Ver link](url) → Ver link: url
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[*-]\s+/gm, '• ') // viñetas
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
