import { OportunidadInputSchema, type AccionFeedback, type Estado, type FeedbackRow, type Oportunidad, type OportunidadInput, type Tipo } from '../types';
import { normalizar, sumarDias, hoyISO } from '../util/texto';
import type { DB } from './index';

// Acceso a datos: SQL simple y explícito, sin ORM.

type Fila = Record<string, unknown>;

function aOportunidad(f: Fila): Oportunidad {
  return { ...(f as unknown as Oportunidad), razones: JSON.parse(String(f.razones ?? '[]')) };
}

export function claveDe(titulo: string, organizacion: string): string {
  return `${normalizar(titulo)}|${normalizar(organizacion)}`;
}

export function listarOportunidades(db: DB, filtros: { estado?: Estado; tipo?: Tipo } = {}): Oportunidad[] {
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (filtros.estado) {
    where.push('estado = :estado');
    params.estado = filtros.estado;
  }
  if (filtros.tipo) {
    where.push('tipo = :tipo');
    params.tipo = filtros.tipo;
  }
  const sql = `SELECT * FROM oportunidades ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY COALESCE(puntaje, -1) DESC, plazo IS NULL, plazo`;
  return (db.prepare(sql).all(params) as Fila[]).map(aOportunidad);
}

export function obtenerOportunidad(db: DB, id: number): Oportunidad | undefined {
  const f = db.prepare('SELECT * FROM oportunidades WHERE id = ?').get(id) as Fila | undefined;
  return f && aOportunidad(f);
}

// Inserta si no existe (dedupe por URL o por título+organización).
export function insertarOportunidad(db: DB, input: OportunidadInput): { id: number; nueva: boolean } {
  const op = OportunidadInputSchema.parse(input);
  const clave = claveDe(op.titulo, op.organizacion);
  const r = db
    .prepare(
      `INSERT INTO oportunidades (titulo, organizacion, tipo, descripcion, url, ubicacion, modalidad, plazo, fuente, clave)
       VALUES (:titulo, :organizacion, :tipo, :descripcion, :url, :ubicacion, :modalidad, :plazo, :fuente, :clave)
       ON CONFLICT DO NOTHING`,
    )
    .run({ ...op, clave });
  if (r.changes > 0) return { id: Number(r.lastInsertRowid), nueva: true };
  const existente = db.prepare('SELECT id FROM oportunidades WHERE url = ? OR clave = ?').get(op.url, clave) as { id: number };
  return { id: existente.id, nueva: false };
}

export function cambiarEstado(db: DB, id: number, estado: Estado): void {
  db.prepare(`UPDATE oportunidades SET estado = ?, actualizado_en = datetime('now') WHERE id = ?`).run(estado, id);
}

export function guardarPuntaje(db: DB, id: number, puntaje: number, razones: string[]): void {
  db.prepare('UPDATE oportunidades SET puntaje = ?, razones = ? WHERE id = ?').run(puntaje, JSON.stringify(razones), id);
}

export function insertarFeedback(db: DB, f: { oportunidad_id: number | null; accion: AccionFeedback; motivo: string }): number {
  const r = db.prepare('INSERT INTO feedback (oportunidad_id, accion, motivo) VALUES (?, ?, ?)').run(f.oportunidad_id, f.accion, f.motivo);
  return Number(r.lastInsertRowid);
}

export function listarFeedback(db: DB): FeedbackRow[] {
  return db
    .prepare(
      `SELECT f.*, o.titulo, o.organizacion, o.tipo
       FROM feedback f LEFT JOIN oportunidades o ON o.id = f.oportunidad_id
       ORDER BY f.id DESC`,
    )
    .all() as FeedbackRow[];
}

export function insertarPostulacion(db: DB, oportunidad_id: number, borrador: string): number {
  const r = db.prepare('INSERT INTO postulaciones (oportunidad_id, borrador) VALUES (?, ?)').run(oportunidad_id, borrador);
  return Number(r.lastInsertRowid);
}

export function listarPostulaciones(db: DB) {
  return db
    .prepare(
      `SELECT p.*, o.titulo, o.organizacion, o.url, o.plazo
       FROM postulaciones p JOIN oportunidades o ON o.id = p.oportunidad_id
       ORDER BY p.id DESC`,
    )
    .all();
}

export function estadisticas(db: DB, hoy = hoyISO()) {
  const contar = (sql: string, ...p: string[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  const agrupar = (col: 'estado' | 'tipo') =>
    Object.fromEntries(
      (db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM oportunidades GROUP BY ${col}`).all() as { k: string; n: number }[]).map(
        (r) => [r.k, r.n],
      ),
    );
  return {
    total: contar('SELECT COUNT(*) AS n FROM oportunidades'),
    porEstado: agrupar('estado'),
    porTipo: agrupar('tipo'),
    postulaciones: contar('SELECT COUNT(*) AS n FROM postulaciones'),
    feedback: contar('SELECT COUNT(*) AS n FROM feedback'),
    cierranEn7Dias: contar(
      `SELECT COUNT(*) AS n FROM oportunidades WHERE estado != 'descartada' AND plazo BETWEEN ? AND ?`,
      hoy,
      sumarDias(hoy, 7),
    ),
  };
}

export type Fuente = { id: number; nombre: string; tipo: 'apify' | 'tavily' | 'manual'; url: string | null; consulta: string | null; activa: number };

export function listarFuentes(db: DB, soloActivas = false): Fuente[] {
  return db.prepare(`SELECT * FROM fuentes ${soloActivas ? 'WHERE activa = 1' : ''} ORDER BY id`).all() as Fuente[];
}

export function activarFuente(db: DB, id: number, activa: boolean): boolean {
  return db.prepare('UPDATE fuentes SET activa = ? WHERE id = ?').run(activa ? 1 : 0, id).changes > 0;
}

// ---------- avisos (Fase 6) ----------

export type TipoAviso = 'nueva' | 'plazo';

export function yaAvisada(db: DB, oportunidadId: number, tipo: TipoAviso): boolean {
  return !!db.prepare('SELECT 1 FROM avisos WHERE oportunidad_id = ? AND tipo = ?').get(oportunidadId, tipo);
}

export function marcarAvisada(db: DB, oportunidadId: number, tipo: TipoAviso): void {
  db.prepare('INSERT OR IGNORE INTO avisos (oportunidad_id, tipo) VALUES (?, ?)').run(oportunidadId, tipo);
}

// Oportunidades vivas (no descartadas) cuyo plazo cae entre dos fechas, inclusive.
export function oportunidadesConPlazo(db: DB, desde: string, hasta: string): Oportunidad[] {
  return (
    db
      .prepare(`SELECT * FROM oportunidades WHERE estado != 'descartada' AND plazo BETWEEN ? AND ? ORDER BY plazo`)
      .all(desde, hasta) as Fila[]
  ).map(aOportunidad);
}
