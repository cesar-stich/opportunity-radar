import { pathToFileURL } from 'node:url';
import type { OportunidadInput } from '../types';
import { hoyISO, sumarDias } from '../util/texto';
import { abrirDb, type DB } from './index';
import { insertarOportunidad } from './repo';

// ~15 oportunidades FICTICIAS (organizaciones inventadas, URLs en example.com) para probar sin scraping.
// Los plazos son relativos a hoy, así el demo siempre tiene ofertas vigentes.

export function oportunidadesDePrueba(hoy = hoyISO()): OportunidadInput[] {
  const en = (dias: number) => sumarDias(hoy, dias);
  const url = (slug: string) => `https://example.com/radar/${slug}`;
  return [
    { titulo: 'Practicante de Data Analytics', organizacion: 'Banco Andino', tipo: 'practica', descripcion: 'Análisis de datos con SQL y Python, dashboards para el área de banca personal.', url: url('banco-andino-data'), ubicacion: 'Lima (San Isidro)', modalidad: 'hibrido', plazo: en(12) },
    { titulo: 'Prácticas pre-profesionales en Redes y Telecomunicaciones', organizacion: 'TelcoSur Perú', tipo: 'practica', descripcion: 'Soporte a la red 5G y fibra óptica, monitoreo en el NOC.', url: url('telcosur-redes'), ubicacion: 'Lima (Surquillo)', modalidad: 'presencial', plazo: en(20) },
    { titulo: 'Practicante de Ventas Retail', organizacion: 'Tiendas del Norte', tipo: 'practica', descripcion: 'Atención al cliente y ventas en tienda.', url: url('tiendas-norte-ventas'), ubicacion: 'Lima Norte (Los Olivos)', modalidad: 'presencial', plazo: en(8) },
    { titulo: 'Beca de Especialización en Cloud Computing', organizacion: 'Fundación Nube Andina', tipo: 'beca', descripcion: 'Beca 100% para preparar una certificación cloud (AWS, Azure o GCP).', url: url('nube-andina-beca'), ubicacion: 'Virtual', modalidad: 'remoto', plazo: en(25) },
    { titulo: 'Hackathon IA para el Agro', organizacion: 'AgroTech Lab', tipo: 'hackathon', descripcion: 'Soluciones con inteligencia artificial para pequeños agricultores.', url: url('agrotech-hackathon'), ubicacion: 'Arequipa', modalidad: 'presencial', plazo: en(15) },
    { titulo: 'Hackathon de Datos Abiertos', organizacion: 'Red de Datos Abiertos Lima', tipo: 'hackathon', descripcion: 'Dos días creando apps con datos públicos de la ciudad.', url: url('datos-abiertos-hackathon'), ubicacion: 'Lima (Cercado)', modalidad: 'presencial', plazo: en(10) },
    { titulo: 'Curso gratuito: Machine Learning con Python', organizacion: 'Academia Digital Pacífico', tipo: 'curso', descripcion: 'Curso online de 6 semanas: regresión, clasificación y redes neuronales.', url: url('pacifico-ml'), ubicacion: 'Online', modalidad: 'remoto', plazo: en(30) },
    { titulo: 'Programa Jóvenes Talento Telecom', organizacion: 'Conecta Perú', tipo: 'convocatoria', descripcion: 'Convocatoria para estudiantes de últimos ciclos de telecomunicaciones y electrónica.', url: url('conecta-talento'), ubicacion: 'Lima', modalidad: 'presencial', plazo: en(5) },
    { titulo: 'Beca de Movilidad Académica', organizacion: 'Universidad del Sur de Chile', tipo: 'beca', descripcion: 'Un semestre de intercambio en ingeniería.', url: url('usur-movilidad'), ubicacion: 'Santiago de Chile', modalidad: 'presencial', plazo: en(40) },
    { titulo: 'Practicante de Cloud Engineering', organizacion: 'Nimbus Soluciones', tipo: 'practica', descripcion: 'Automatización de infraestructura cloud en AWS e integración de modelos de IA.', url: url('nimbus-cloud'), ubicacion: 'Remoto', modalidad: 'remoto', plazo: en(2) },
    { titulo: 'Practicante Contable', organizacion: 'Estudio Contable Ríos', tipo: 'practica', descripcion: 'Registro de facturas y conciliaciones bancarias.', url: url('rios-contable'), ubicacion: 'Lima (Miraflores)', modalidad: 'presencial', plazo: en(14) },
    { titulo: 'Curso HCIP-AI (preparación)', organizacion: 'Academia ICT Andes', tipo: 'curso', descripcion: 'Preparación para la certificación profesional de inteligencia artificial.', url: url('ict-andes-hcip-ai'), ubicacion: 'Virtual', modalidad: 'remoto', plazo: en(18) },
    { titulo: 'Concurso Nacional de Innovación Estudiantil', organizacion: 'Red Universitaria de Innovación', tipo: 'convocatoria', descripcion: 'Premios para proyectos tecnológicos con impacto social; se valoran datos e IA.', url: url('rui-concurso'), ubicacion: 'Lima', modalidad: 'hibrido', plazo: en(21) },
    { titulo: 'Practicante de Ciberseguridad', organizacion: 'Banco Andino', tipo: 'practica', descripcion: 'Monitoreo de redes y gestión de incidentes en banca.', url: url('banco-andino-ciber'), ubicacion: 'Lima (San Isidro)', modalidad: 'presencial', plazo: en(9) },
    { titulo: 'Hackathon FinTech', organizacion: 'Cámara FinTech Perú', tipo: 'hackathon', descripcion: 'Pagos digitales e inclusión financiera.', url: url('fintech-hackathon'), ubicacion: 'Lima', modalidad: 'presencial', plazo: en(-3) },
  ].map((o) => ({ ...o, fuente: 'seed' }) as OportunidadInput);
}

export function sembrar(db: DB, hoy = hoyISO()): { nuevas: number; total: number } {
  let nuevas = 0;
  const ops = oportunidadesDePrueba(hoy);
  for (const op of ops) if (insertarOportunidad(db, op).nueva) nuevas++;

  // Fuentes que recorre `pnpm escanear` (y en la Fase 6, el escaneo diario). Se agregan las que falten por nombre,
  // sin tocar si las activaste o desactivaste. Cada escaneo gasta 1 crédito de Tavily por búsqueda y una
  // corrida corta de Apify por portal.
  const ins = db.prepare(
    `INSERT INTO fuentes (nombre, tipo, url, consulta) SELECT :nombre, :tipo, :url, :consulta
     WHERE NOT EXISTS (SELECT 1 FROM fuentes WHERE nombre = :nombre)`,
  );
  for (const f of FUENTES) ins.run({ url: null, consulta: null, ...f });
  return { nuevas, total: ops.length };
}

const FUENTES = [
  { nombre: 'Prácticas telecom Lima', tipo: 'tavily', consulta: 'prácticas pre profesionales telecomunicaciones Lima' },
  { nombre: 'Becas IA Perú', tipo: 'tavily', consulta: 'becas inteligencia artificial estudiantes Perú' },
  { nombre: 'Hackathones Perú', tipo: 'tavily', consulta: 'hackathon Perú estudiantes' },
  // Portales públicos del Estado (HTML sin JavaScript; robots.txt lo permite o no existe). Una sola página por escaneo.
  { nombre: 'PRONABEC becas internacionales', tipo: 'apify', url: 'https://www.pronabec.gob.pe/becas-de-cooperacion-internacional/' },
  { nombre: 'OSIPTEL prácticas vigentes', tipo: 'apify', url: 'https://www.osiptel.gob.pe/vigentes-practicas/' },
];

// `pnpm seed`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { leerEnv } = await import('../config');
  const db = abrirDb(leerEnv().DB_PATH);
  const { nuevas, total } = sembrar(db);
  console.log(`Seed listo: ${nuevas} nuevas de ${total} oportunidades de prueba.`);
}
