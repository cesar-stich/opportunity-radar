import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// SQLite nativo de Node (node:sqlite): cero dependencias nativas que compilar en Windows ni en Docker.
export type DB = DatabaseSync;

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS fuentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('apify', 'tavily', 'manual')),
  url TEXT,
  consulta TEXT,
  activa INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oportunidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  organizacion TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL CHECK (tipo IN ('practica', 'beca', 'hackathon', 'convocatoria', 'curso')),
  descripcion TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL UNIQUE,
  ubicacion TEXT NOT NULL DEFAULT '',
  modalidad TEXT NOT NULL DEFAULT 'presencial',
  plazo TEXT,
  fuente TEXT NOT NULL DEFAULT 'manual',
  estado TEXT NOT NULL DEFAULT 'nueva'
    CHECK (estado IN ('nueva', 'interesa', 'postulada', 'respondida', 'descartada')),
  puntaje INTEGER,
  razones TEXT NOT NULL DEFAULT '[]',
  clave TEXT NOT NULL UNIQUE, -- título + organización normalizados: deduplica la misma oferta con otra URL
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS postulaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oportunidad_id INTEGER NOT NULL REFERENCES oportunidades(id),
  borrador TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'enviada', 'respondida')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Qué avisos ya se mandaron (uno por oportunidad y tipo) para no repetirlos en cada escaneo.
CREATE TABLE IF NOT EXISTS avisos (
  oportunidad_id INTEGER NOT NULL REFERENCES oportunidades(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('nueva', 'plazo')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (oportunidad_id, tipo)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oportunidad_id INTEGER REFERENCES oportunidades(id),
  accion TEXT NOT NULL CHECK (accion IN ('descartar', 'aceptar', 'comentario')),
  motivo TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function abrirDb(ruta: string): DB {
  if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(ESQUEMA);
  return db;
}
