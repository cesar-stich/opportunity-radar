// Utilidades de texto y fechas compartidas por el puntaje, el agente y los mocks.

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(
  `para porque pero nada mucho muchos tipo cosas cosa oferta ofertas oportunidad oportunidades favor gracias mejor ahora
  solo tampoco nunca tengo tiempo numero primera segunda tercera cuarta quinta esas estas esos estos como cuando donde
  sobre estan este esta esto otra otras otro otros quiero gusta gustan interesa interesan descarta descartar descartala
  descartalo descarte quita quitala borra borrala nadie algo alguna algun todas todos cual cuales mismo misma tambien
  aqui alla bueno buena malo mala hola chau creo parece`.split(/\s+/),
);

// Palabras significativas de una frase (para comparar feedback con oportunidades).
export function palabrasClave(s: string): string[] {
  const unicas = new Set(
    normalizar(s)
      .split(/[^a-z0-9ñ]+/)
      .filter((p) => p.length >= 4 && !STOP.has(p) && !/^\d+$/.test(p)),
  );
  return [...unicas];
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ¿Aparece `termino` como palabra completa en `texto`? (ambos ya normalizados)
export function contienePalabra(texto: string, termino: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapar(termino)}([^a-z0-9]|$)`).test(texto);
}

// ¿Aparece alguna palabra que empiece con la raíz de `palabra`? ("becas" ≈ "beca")
export function contieneRaiz(texto: string, palabra: string): boolean {
  const raiz = palabra.length > 4 ? palabra.replace(/(es|s)$/, '') : palabra;
  return new RegExp(`(^|[^a-z0-9])${escapar(raiz)}`).test(texto);
}

// Fecha de hoy en Lima, formato YYYY-MM-DD.
export function hoyISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

export function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(`${fechaISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasHasta(plazo: string, hoy = hoyISO()): number {
  return Math.round((Date.parse(`${plazo}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
}
