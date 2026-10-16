import type { SearchTool } from '../interfaces';
import type { OportunidadInput } from '../types';
import { hoyISO, sumarDias } from '../util/texto';

// Tavily = búsqueda abierta: descubrir oportunidades nuevas y enriquecer cada una.

// Mock: devuelve un hallazgo ficticio por consulta (URL en example.com).
export class MockSearch implements SearchTool {
  nombre = 'mock';
  async buscar(consulta: string): Promise<OportunidadInput[]> {
    const slug = consulta.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    return [
      {
        titulo: `Resultado simulado: ${consulta}`,
        organizacion: 'Buscador Mock',
        tipo: 'convocatoria',
        descripcion: `Oportunidad de prueba encontrada para "${consulta}".`,
        url: `https://example.com/tavily/${slug}`,
        ubicacion: 'Lima',
        modalidad: 'remoto',
        plazo: sumarDias(hoyISO(), 20),
        fuente: 'tavily-mock',
      },
    ];
  }
  async enriquecer(op: { titulo: string; organizacion: string }) {
    return `(mock) ${op.organizacion} es una organización ficticia; no hay noticias recientes sobre "${op.titulo}".`;
  }
}

// Real: pendiente Fase 3.
export class TavilySearch implements SearchTool {
  nombre = 'tavily';
  constructor(private apiKey?: string) {}
  async buscar(): Promise<OportunidadInput[]> {
    throw new Error('Tavily real: pendiente Fase 3 (usa TAVILY_MODE=mock)');
  }
  async enriquecer(): Promise<string> {
    throw new Error('Tavily real: pendiente Fase 3 (usa TAVILY_MODE=mock)');
  }
}
