// El LLM responde con Markdown (**negrita**, [texto](url)). Cada canal lo muestra distinto, así que lo adaptamos.
// WhatsApp usa *negrita*; Telegram vía Zavu: texto plano (evita errores de formato con símbolos como _ o [ ] en los títulos).
export function aTextoPlano(md: string, canal: 'whatsapp' | 'telegram'): string {
  return md
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2') // [Ver link](url) → Ver link: url
    .replace(/\*\*(.+?)\*\*/g, canal === 'whatsapp' ? '*$1*' : '$1')
    .replace(/^\s*[*-]\s+/gm, '• ') // viñetas
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
