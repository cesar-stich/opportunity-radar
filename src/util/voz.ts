// Convierte una respuesta escrita (con enlaces, emojis y puntajes) en algo que suene bien al leerlo en voz alta
// y que no gaste créditos de ElevenLabs de más (1 crédito ≈ 1 carácter en el plan Free).

const MAX_CARACTERES = 900;

export function textoParaVoz(texto: string, max = MAX_CARACTERES): string {
  const limpio = texto
    .replace(/https?:\/\/\S+/g, '') // los enlaces no se leen: van en el texto
    .replace(/\[(\d+)\/100\]/g, '$1 de 100,')
    .replace(/\p{Extended_Pictographic}|️/gu, '')
    .replace(/[*_`#>•]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?:;,]$/.test(l) ? l : `${l}.`))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.lastIndexOf('. ', max);
  return `${limpio.slice(0, corte > max / 2 ? corte + 1 : max).trim()} Lo demás te lo dejo por escrito.`;
}
