import type { MemoryStore, Recuerdo } from '../interfaces';
import { contieneRaiz, normalizar, palabrasClave } from '../util/texto';

// AtomicMemory = memoria a largo plazo (perfil, gustos, feedback). El agente la consulta antes de puntuar.

// Mock: en RAM, búsqueda por palabras. Se pierde al reiniciar (el feedback igual queda en SQLite).
export class MockMemory implements MemoryStore {
  nombre = 'mock';
  private recuerdos: Recuerdo[] = [];

  async guardar(texto: string, meta?: Record<string, string>) {
    this.recuerdos.push({ texto, meta });
  }

  async buscar(consulta: string, limite = 10) {
    const claves = palabrasClave(consulta);
    const puntuados = this.recuerdos.map((r) => ({
      r,
      n: claves.filter((k) => contieneRaiz(normalizar(r.texto), k)).length,
    }));
    // Sin coincidencias devolvemos los más recientes: la memoria es pequeña.
    const conCoincidencia = puntuados.filter((p) => p.n > 0).sort((a, b) => b.n - a.n);
    const lista = conCoincidencia.length ? conCoincidencia.map((p) => p.r) : [...this.recuerdos].reverse();
    return lista.slice(0, limite);
  }
}

// Real: pendiente Fase 2 (core HTTP de AtomicMemory + Postgres/pgvector en Docker).
export class AtomicMemoryStore implements MemoryStore {
  nombre = 'atomicmemory';
  constructor(
    private url: string,
    private apiKey?: string,
  ) {}

  async guardar(): Promise<void> {
    throw new Error('AtomicMemory real: pendiente Fase 2 (usa MEMORY_MODE=mock)');
  }

  async buscar(): Promise<Recuerdo[]> {
    throw new Error('AtomicMemory real: pendiente Fase 2 (usa MEMORY_MODE=mock)');
  }
}
