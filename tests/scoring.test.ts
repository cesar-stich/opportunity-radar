import { describe, expect, it } from 'vitest';
import { puntuar } from '../src/agent/scoring';
import { cargarPerfil } from '../src/deps';
import type { FeedbackRow } from '../src/types';

const perfil = cargarPerfil();
const HOY = '2026-10-16';

const base = { titulo: 'Practicante de Cloud', organizacion: 'Nimbus', tipo: 'practica' as const, descripcion: 'AWS e inteligencia artificial', ubicacion: 'Lima', plazo: '2026-10-30' };

const descarte = (motivo: string, extra: Partial<FeedbackRow> = {}): FeedbackRow => ({
  id: 1, oportunidad_id: null, accion: 'descartar', motivo, creado_en: '', titulo: null, organizacion: null, tipo: null, ...extra,
});

describe('puntuar', () => {
  it('premia tipo buscado, intereses y ubicación', () => {
    const r = puntuar(base, perfil, undefined, HOY);
    expect(r.puntaje).toBeGreaterThanOrEqual(80);
    expect(r.razones.join(' ')).toMatch(/cloud/i);
    expect(r.razones.join(' ')).toMatch(/IA/);
  });

  it('pone 0 si el plazo venció', () => {
    expect(puntuar({ ...base, plazo: '2026-10-01' }, perfil, undefined, HOY).puntaje).toBe(0);
  });

  it('baja el puntaje de lo presencial fuera de Lima', () => {
    const lejos = puntuar({ ...base, ubicacion: 'Arequipa' }, perfil, undefined, HOY);
    expect(lejos.puntaje).toBeLessThan(puntuar(base, perfil, undefined, HOY).puntaje);
  });

  it('aprende de un descarte: "no me interesa Lima Norte" baja ofertas en Lima Norte, no en todo Lima', () => {
    const senales = { feedback: [descarte('descarta la 3, no me interesa Lima Norte')], recuerdos: [] };
    const norte = puntuar({ ...base, ubicacion: 'Lima Norte (Comas)' }, perfil, senales, HOY);
    const centro = puntuar(base, perfil, senales, HOY);
    expect(norte.puntaje).toBeLessThan(centro.puntaje);
    expect(norte.razones.join(' ')).toMatch(/descartaste/);
    expect(centro.razones.join(' ')).not.toMatch(/descartaste/);
  });

  it('también usa recuerdos de la memoria semántica', () => {
    const senales = { feedback: [], recuerdos: [{ texto: 'no me interesa banca', meta: { accion: 'descartar' } }] };
    const banca = puntuar({ ...base, descripcion: 'Dashboards para banca' }, perfil, senales, HOY);
    expect(banca.razones.join(' ')).toMatch(/descartaste/);
  });

  it('entiende los hechos que AtomicMemory extrae en inglés', () => {
    const senales = { feedback: [], recuerdos: [{ texto: 'As of October 16 2026, user is not interested in Lima Norte.' }] };
    const norte = puntuar({ ...base, ubicacion: 'Lima Norte (Comas)' }, perfil, senales, HOY);
    const centro = puntuar(base, perfil, senales, HOY);
    expect(norte.puntaje).toBeLessThan(centro.puntaje);
    expect(centro.razones.join(' ')).not.toMatch(/descartaste/);
  });
});
