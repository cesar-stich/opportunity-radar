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

// Real: core HTTP de AtomicMemory (docker-compose.yml). API verificada contra la imagen 1.2.2 el 2026-10-16:
//   POST /v1/memories/ingest  { user_id, conversation, source_site } → extrae hechos con su LLM y los guarda
//   POST /v1/memories/search  { user_id, query, limit }             → { memories: [{ content }] }
//   GET  /v1/memories/list?user_id=                                  → { memories: [{ content }] }
// Ojo: extrae los hechos en inglés ("User is not interested in ...").
export class AtomicMemoryStore implements MemoryStore {
  nombre = 'atomicmemory';
  constructor(
    private url: string,
    private apiKey = 'radar-local-dev',
    private usuario = 'radar-cesar',
  ) {}

  private async pedir(ruta: string, init: RequestInit = {}) {
    const res = await fetch(`${this.url}${ruta}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`AtomicMemory ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as { memories?: { content: string }[] };
  }

  async guardar(texto: string, meta?: Record<string, string>) {
    // Le damos contexto en la "conversación" para que el extractor entienda qué significa el feedback.
    const contexto = meta?.oportunidad ? ` (sobre la oportunidad "${meta.oportunidad}" de ${meta.organizacion ?? '?'})` : '';
    const accion = meta?.accion === 'descartar' ? 'Descarto esto' : meta?.accion === 'aceptar' ? 'Me interesa esto' : 'Nota';
    await this.pedir('/v1/memories/ingest', {
      method: 'POST',
      body: JSON.stringify({ user_id: this.usuario, conversation: `user: ${accion}${contexto}: ${texto}`, source_site: 'radar' }),
    });
  }

  async buscar(consulta: string, limite = 10): Promise<Recuerdo[]> {
    const r = await this.pedir('/v1/memories/search', {
      method: 'POST',
      body: JSON.stringify({ user_id: this.usuario, query: consulta, limit: limite }),
    });
    let memorias = r.memories ?? [];
    // El modelo de embeddings local es pequeño: si la búsqueda no encuentra nada, la memoria personal
    // es corta y podemos leerla completa.
    if (!memorias.length) memorias = (await this.pedir(`/v1/memories/list?user_id=${this.usuario}&limit=${limite}`)).memories ?? [];
    return memorias.slice(0, limite).map((m) => ({ texto: m.content }));
  }
}
