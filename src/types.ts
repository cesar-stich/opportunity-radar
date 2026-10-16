import { z } from 'zod';

export const TIPOS = ['practica', 'beca', 'hackathon', 'convocatoria', 'curso'] as const;
export const ESTADOS = ['nueva', 'interesa', 'postulada', 'respondida', 'descartada'] as const;
export const MODALIDADES = ['presencial', 'remoto', 'hibrido'] as const;
export type Tipo = (typeof TIPOS)[number];
export type Estado = (typeof ESTADOS)[number];

export const ETIQUETA_TIPO: Record<Tipo, string> = {
  practica: 'práctica',
  beca: 'beca',
  hackathon: 'hackathon',
  convocatoria: 'convocatoria',
  curso: 'curso',
};

const fechaISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa formato YYYY-MM-DD');

// Lo mínimo para puntuar una oportunidad (también es el contrato público de /match).
export const ParaPuntuarSchema = z.object({
  titulo: z.string().min(1),
  organizacion: z.string().default(''),
  tipo: z.enum(TIPOS),
  descripcion: z.string().default(''),
  ubicacion: z.string().default(''),
  modalidad: z.enum(MODALIDADES).default('presencial'),
  plazo: fechaISO.nullable().default(null),
});
export type ParaPuntuar = z.input<typeof ParaPuntuarSchema>;

export const OportunidadInputSchema = ParaPuntuarSchema.extend({
  url: z.url(),
  fuente: z.string().default('manual'),
});
export type OportunidadInput = z.input<typeof OportunidadInputSchema>;

export type Oportunidad = z.output<typeof OportunidadInputSchema> & {
  id: number;
  estado: Estado;
  puntaje: number | null;
  razones: string[];
  creado_en: string;
  actualizado_en: string;
};

export const PerfilSchema = z.object({
  nombre: z.string(),
  estudios: z.string(),
  certificaciones: z.array(z.string()).default([]),
  experiencia: z.array(z.string()).default([]),
  busca: z.array(z.string()).default([]),
  intereses: z.array(z.string()).default([]),
  ubicacion: z.string().default(''),
  idioma: z.string().default('español'),
});
export type Perfil = z.infer<typeof PerfilSchema>;

export type AccionFeedback = 'descartar' | 'aceptar' | 'comentario';

export type FeedbackRow = {
  id: number;
  oportunidad_id: number | null;
  accion: AccionFeedback;
  motivo: string;
  creado_en: string;
  // Datos de la oportunidad asociada (si la hay)
  titulo: string | null;
  organizacion: string | null;
  tipo: Tipo | null;
};
