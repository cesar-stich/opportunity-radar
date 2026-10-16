import type { Scraper } from '../interfaces';
import type { OportunidadInput } from '../types';
import { hoyISO, sumarDias } from '../util/texto';

// Apify = scraping de portales de convocatorias que no tienen API (lista en la tabla `fuentes`).

// Mock: devuelve una oferta ficticia por fuente.
export class MockScraper implements Scraper {
  nombre = 'mock';
  async scrapear(fuente: { nombre: string; url: string }): Promise<OportunidadInput[]> {
    return [
      {
        titulo: `Practicante de Soporte TI (simulado desde ${fuente.nombre})`,
        organizacion: 'Portal Mock',
        tipo: 'practica',
        descripcion: 'Oferta de prueba obtenida por el scraper mock: soporte de redes y cloud.',
        url: `https://example.com/apify/${encodeURIComponent(fuente.nombre)}`,
        ubicacion: 'Lima',
        modalidad: 'hibrido',
        plazo: sumarDias(hoyISO(), 10),
        fuente: 'apify-mock',
      },
    ];
  }
}

// Real: pendiente Fase 3.
export class ApifyScraper implements Scraper {
  nombre = 'apify';
  constructor(private token?: string) {}
  async scrapear(): Promise<OportunidadInput[]> {
    throw new Error('Apify real: pendiente Fase 3 (usa APIFY_MODE=mock)');
  }
}
