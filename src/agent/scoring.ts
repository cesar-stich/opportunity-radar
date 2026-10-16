import type { Recuerdo } from '../interfaces';
import { ETIQUETA_TIPO, ParaPuntuarSchema, type FeedbackRow, type ParaPuntuar, type Perfil, type Tipo } from '../types';
import { contienePalabra, contieneRaiz, diasHasta, hoyISO, normalizar, palabrasClave } from '../util/texto';

// Puntaje determinista (0–100) con razones. Es determinista a propósito: así es testeable, barato
// (no gasta tokens) y el mismo cálculo sirve para el agente y para /match. El LLM solo lo explica.

export type Senales = { feedback: FeedbackRow[]; recuerdos: Recuerdo[] };
export const SIN_SENALES: Senales = { feedback: [], recuerdos: [] };

const TIPO_EN_BUSCA: Record<Tipo, string[]> = {
  practica: ['practica', 'pasantia', 'internship'],
  beca: ['beca'],
  hackathon: ['hackathon'],
  curso: ['curso'],
  convocatoria: ['convocatoria', 'concurso'],
};

// Sinónimos para que "IA" también encaje con "inteligencia artificial", etc.
const SINONIMOS: Record<string, string[]> = {
  ia: ['inteligencia artificial', 'ai'],
  'machine learning': ['ml', 'aprendizaje automatico'],
  cloud: ['nube', 'aws', 'azure', 'gcp'],
  telecomunicaciones: ['telecom', 'redes', '5g', 'fibra optica'],
  datos: ['data', 'analytics', 'analitica'],
};

// Español (feedback directo) e inglés (AtomicMemory guarda los hechos extraídos en inglés).
const PATRON_NEGATIVO = /no me interesa|no me gusta|no quiero|descart|evitar|paso de|not interested|discard|does not want|doesn't want|dislike|avoid/;

export function puntuar(
  entrada: ParaPuntuar,
  perfil: Perfil,
  senales: Senales = SIN_SENALES,
  hoy = hoyISO(),
): { puntaje: number; razones: string[] } {
  const op = ParaPuntuarSchema.parse(entrada);
  const razones: string[] = [];
  let p = 40;
  const texto = normalizar(`${op.titulo} ${op.organizacion} ${op.descripcion}`);

  // 1. Plazo
  if (op.plazo) {
    const dias = diasHasta(op.plazo, hoy);
    if (dias < 0) return { puntaje: 0, razones: ['El plazo ya venció'] };
    if (dias <= 3) razones.push(dias === 0 ? 'Cierra HOY' : `Cierra en ${dias} día(s), ¡apúrate!`);
  }

  // 2. ¿Es el tipo de cosa que busca?
  const busca = normalizar(perfil.busca.join(' '));
  if (TIPO_EN_BUSCA[op.tipo].some((k) => busca.includes(k))) {
    p += 20;
    razones.push(`Es ${ETIQUETA_TIPO[op.tipo]}, algo que buscas`);
  }

  // 3. Intereses
  const aciertos = perfil.intereses.filter((i) => {
    const n = normalizar(i);
    return [n, ...(SINONIMOS[n] ?? [])].some((t) => contienePalabra(texto, t));
  });
  if (aciertos.length) {
    p += Math.min(aciertos.length * 8, 24);
    razones.push(`Encaja con tus intereses: ${aciertos.join(', ')}`);
  }

  // 4. Ubicación
  const ciudad = perfil.ubicacion.split(',')[0].trim();
  const lugar = normalizar(`${op.ubicacion} ${op.modalidad}`);
  if (op.modalidad === 'remoto' || /remot|virtual|online/.test(lugar)) {
    p += 8;
    razones.push('Es remoto/virtual');
  } else if (ciudad && lugar.includes(normalizar(ciudad))) {
    p += 8;
    razones.push(`Es en ${ciudad}`);
  } else if (op.ubicacion) {
    p -= 15;
    razones.push(`Es presencial en ${op.ubicacion}`);
  }

  // 5. Feedback y memoria: lo que descartó antes baja el puntaje (una sola penalización).
  const textoConLugar = `${texto} ${normalizar(op.ubicacion)}`;
  const motivosNegativos = new Set([
    ...senales.feedback.filter((f) => f.accion === 'descartar' && f.motivo).map((f) => f.motivo),
    ...senales.recuerdos
      .filter((r) => r.meta?.accion === 'descartar' || (!r.meta?.accion && PATRON_NEGATIVO.test(normalizar(r.texto))))
      .map((r) => r.texto),
  ]);
  const parecido = [...motivosNegativos].find((motivo) => {
    const claves = palabrasClave(motivo);
    const n = claves.filter((k) => contieneRaiz(textoConLugar, k)).length;
    return claves.length > 0 && n >= Math.min(2, claves.length);
  });
  if (parecido) {
    p -= 30;
    const cita = parecido.length > 70 ? `${parecido.slice(0, 67)}…` : parecido;
    razones.push(`Se parece a algo que descartaste: "${cita}"`);
  }

  const orgDescartada =
    op.organizacion &&
    senales.feedback.some((f) => f.accion === 'descartar' && f.organizacion && normalizar(f.organizacion) === normalizar(op.organizacion));
  if (orgDescartada) {
    p -= 10;
    razones.push(`Ya descartaste algo de ${op.organizacion}`);
  }

  if (senales.feedback.some((f) => f.accion === 'aceptar' && f.tipo === op.tipo)) {
    p += 5;
    razones.push(`Te interesaron otras ${ETIQUETA_TIPO[op.tipo]}s parecidas`);
  }

  return { puntaje: Math.max(0, Math.min(100, p)), razones };
}
