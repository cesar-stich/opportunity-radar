import { z } from 'zod';
import { MODALIDADES, ParaPuntuarSchema, PerfilSchema, TIPOS, type ParaPuntuar, type Perfil } from './types';

// /match = servicio de pago por llamada (Qatom): recibe una oportunidad (y, opcional, un perfil) y devuelve puntaje + razones.
// Acepta dos formas:
//  1. Anidada (JSON):  { oportunidad: {...}, perfil?: {...} }
//  2. Plana (la que usa Qatom, cuyo esquema de entrada es una lista de propiedades simples):
//     titulo, tipo, organizacion, descripcion, ubicacion, modalidad, plazo + intereses, busca, ubicacion_perfil
//     (las tres últimas como texto separado por comas). También llega por query string en un GET.
// Sin perfil se usa el del dueño del agente (útil para la demo).

const Anidada = z.object({ perfil: PerfilSchema.optional(), oportunidad: ParaPuntuarSchema });

const lista = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

const Plana = z.object({
  titulo: z.string().min(1),
  tipo: z.enum(TIPOS),
  organizacion: z.string().optional(),
  descripcion: z.string().optional(),
  ubicacion: z.string().optional(),
  modalidad: z.enum(MODALIDADES).optional(),
  plazo: z.string().optional(),
  intereses: z.string().optional(),
  busca: z.string().optional(),
  ubicacion_perfil: z.string().optional(),
});

export type ErrorMatch = { code: string; message: string; next_step: string };
export type EntradaMatch = { ok: true; oportunidad: ParaPuntuar; perfil?: Perfil } | { ok: false; error: ErrorMatch };

// Las recomendaciones de Qatom: cada error con código, mensaje claro y qué hacer.
const invalido = (e: z.ZodError): EntradaMatch => ({
  ok: false,
  error: { code: 'invalid_input', message: z.prettifyError(e), next_step: 'Revisa los campos: titulo y tipo (practica|beca|hackathon|convocatoria|curso) son obligatorios; plazo va como YYYY-MM-DD.' },
});

export function leerEntradaMatch(datos: unknown): EntradaMatch {
  const crudo = (datos && typeof datos === 'object' ? datos : {}) as Record<string, unknown>;
  if ('oportunidad' in crudo) {
    const r = Anidada.safeParse(crudo);
    return r.success ? { ok: true, oportunidad: r.data.oportunidad, perfil: r.data.perfil } : invalido(r.error);
  }
  // Qatom declara additionalProperties:false; aquí también se rechazan campos desconocidos para no ignorar errores de tipeo.
  const r = Plana.strict().safeParse(crudo);
  if (!r.success) {
    const desconocido = r.error.issues.find((i) => i.code === 'unrecognized_keys');
    return desconocido
      ? { ok: false, error: { code: 'unknown_parameter', message: z.prettifyError(r.error), next_step: 'Usa solo los parámetros del esquema de entrada.' } }
      : invalido(r.error);
  }
  const { intereses, busca, ubicacion_perfil, ...op } = r.data;
  const oportunidad = ParaPuntuarSchema.safeParse({ ...op, plazo: op.plazo ?? null });
  if (!oportunidad.success) return invalido(oportunidad.error);
  const hayPerfil = intereses || busca || ubicacion_perfil;
  return {
    ok: true,
    oportunidad: oportunidad.data,
    perfil: hayPerfil
      ? { nombre: 'Cliente', estudios: '', certificaciones: [], experiencia: [], idioma: 'español', intereses: lista(intereses), busca: lista(busca), ubicacion: ubicacion_perfil ?? '' }
      : undefined,
  };
}
