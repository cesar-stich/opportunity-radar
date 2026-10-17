# Panel de Radar en Lovable

Panel web **de solo lectura** (kanban) que muestra lo que encontró el agente. Los estados se cambian conversando con el bot ("me interesa la 2", "descarta la 3"); el panel se actualiza solo.

## Antes de pegar el prompt

1. En tu servidor (Maritime) define `PANEL_TOKEN` con un valor largo y aleatorio (`openssl rand -hex 24`). Es **distinto** de `API_TOKEN`: solo permite leer `/api/*`, así que si se filtra desde el navegador no pueden conversar con tu agente ni gastar tu cuota. Aun así, quien tenga la URL del panel verá tus oportunidades y borradores: no la compartas.
2. En Lovable, crea el proyecto y pega el prompt de abajo. Cuando Lovable pida las variables (o en Project settings → Environment variables) pon:
   - `VITE_API_URL` = la URL pública de tu servidor, sin `/` final (ej. `https://tu-agente.maritime.app`).
   - `VITE_PANEL_TOKEN` = tu `PANEL_TOKEN`.
3. Prueba antes: `curl "https://TU-URL/api/estadisticas?token=$PANEL_TOKEN"` debe devolver JSON. Con Maritime el panel manda el token en la URL (`?token=`): su URL pública no reenvía `Authorization` y su borde rechaza el preflight CORS de otros orígenes, así que ni `Authorization` ni cabeceras propias sirven desde un navegador (probado). Para scripts como n8n sí vale la cabecera `X-Radar-Token`.

## Prompt para pegar en Lovable

```text
Crea un panel web en español llamado "Radar" para seguir oportunidades para estudiantes (prácticas, becas,
hackathones, convocatorias y cursos). Es de SOLO LECTURA: no hay formularios ni botones que modifiquen datos.
Usa React + TypeScript + Tailwind. Estilo oscuro, limpio y moderno, responsive (en móvil el tablero hace scroll horizontal).

DATOS (API REST ya existente)
- Base: import.meta.env.VITE_API_URL. En TODAS las peticiones (todas son GET) agrega el token en la URL:
  `${VITE_API_URL}/api/oportunidades?token=${import.meta.env.VITE_PANEL_TOKEN}` (con `&token=` si ya hay otros parámetros).
  NO envíes ningún header personalizado ni Authorization: el servidor rechaza el preflight CORS y la petición fallaría.
  Usa fetch(url) a secas, sin opciones de headers.
- GET /api/oportunidades  →  array de objetos:
  { id, titulo, organizacion, tipo: "practica"|"beca"|"hackathon"|"convocatoria"|"curso",
    descripcion, url, ubicacion, modalidad: "presencial"|"remoto"|"hibrido",
    plazo: "YYYY-MM-DD" | null, fuente, estado: "nueva"|"interesa"|"postulada"|"respondida"|"descartada",
    puntaje: number (0-100) | null, razones: string[], creado_en, actualizado_en }
  Acepta filtros opcionales ?estado= y ?tipo=.
- GET /api/postulaciones  →  array de { id, oportunidad_id, borrador (texto), estado: "borrador"|"enviada"|"respondida",
    titulo, organizacion, url, plazo, creado_en }
- GET /api/estadisticas  →  { total, porEstado: {nueva: n, ...}, porTipo: {...}, postulaciones, feedback, cierranEn7Dias }
- Refresca los tres endpoints cada 60 segundos y con un botón "Actualizar". Muestra un estado de carga y un mensaje
  claro si el servidor no responde (puede tardar ~2 segundos en despertar la primera vez: reintenta una vez antes de mostrar error).

PANTALLA PRINCIPAL: TABLERO KANBAN
- Cuatro columnas: "Nuevas" (estado nueva), "Me interesan" (interesa), "Postuladas" (postulada), "Respondidas" (respondida).
  Cada columna muestra su contador. Dentro de cada columna ordena por puntaje descendente (null al final).
- Una sección plegable "Descartadas" debajo del tablero, cerrada por defecto.
- Tarjeta de oportunidad: título (máx. 2 líneas), organización, insignia del tipo con color por tipo, puntaje en un
  círculo o barra (verde ≥ 70, ámbar 40-69, gris < 40, "?" si es null), plazo con cuenta regresiva
  ("cierra en 3 días", "cierra hoy", "vencida" en rojo, "sin plazo" en gris) y ubicación + modalidad.
- Al hacer clic en una tarjeta abre un panel lateral con: descripción completa, la lista "razones" del puntaje
  (viñetas), fuente, fechas, y un botón "Abrir convocatoria" que abre `url` en una pestaña nueva (rel="noopener noreferrer").
  Si la oportunidad tiene borradores en /api/postulaciones (mismo oportunidad_id), muéstralos en el panel con un botón
  "Copiar borrador" y la nota "Este borrador no se ha enviado: lo envías tú."
- Las que vencen en 3 días o menos llevan un borde o etiqueta de urgencia.

BARRA SUPERIOR
- Tarjetas con: total de oportunidades, "Cierran en 7 días" (cierranEn7Dias), borradores (postulaciones) y
  oportunidades por tipo (porTipo) como mini barras.
- Filtros (solo en el cliente): por tipo, texto libre (título/organización) y un selector "Puntaje mínimo" 0-100.

PESTAÑA "BORRADORES"
- Lista de /api/postulaciones: título, organización, fecha, plazo y el borrador en un bloque de texto con botón "Copiar".

REGLAS
- Escapa siempre el texto que viene de la API (no uses dangerouslySetInnerHTML).
- Nunca imprimas ni guardes el token en la consola ni en localStorage.
- Textos de la interfaz en español peruano, tono cercano y breve.
- Incluye datos de ejemplo SOLO si la API devuelve un array vacío, marcados claramente como "ejemplo".
```

## Después de generarlo

- Si Lovable no refleja el CORS, ya está habilitado en `/api/*` del servidor (cualquier origen, solo lectura).
- Si ves 401: revisa que `VITE_PANEL_TOKEN` sea el mismo `PANEL_TOKEN` del servidor, sin comillas ni espacios.
- Si quieres mover tarjetas desde el panel, hace falta un endpoint de escritura (no existe; decisión de seguridad de la Fase 8).
