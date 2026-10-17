# Radar — guía del proyecto

Agente que caza oportunidades para estudiantes (prácticas, becas, hackathones, convocatorias, cursos), las puntúa según el perfil y el feedback, y avisa por Telegram. Ver [README.md](README.md) para uso, arquitectura y rutas.

## Reglas de trabajo

1. **Verifica la documentación oficial** de un servicio antes de integrarlo; si contradice este archivo, gana la documentación y se corrige aquí.
2. **Mock primero.** Cada integración va detrás de una interfaz (`src/interfaces.ts`) con implementación `mock` y `real`, elegida por variable de entorno (`src/deps.ts`). Todo debe correr local sin llaves.
3. **Nunca** subir llaves a git. Mantener `.env.example` al día; `.env` y `.env.prod` están en `.gitignore`.
4. Código simple y legible, sin sobreingeniería. Comentarios breves en español que expliquen el "por qué".
5. **Presupuesto cero:** solo planes gratuitos. Si algo pide pago o tarjeta, se deja en mock.
6. **Las postulaciones nunca se envían solas.** El agente solo genera borradores; cualquier acción con efecto externo exige confirmación explícita. Hoy ninguna herramienta tiene efectos externos.
7. No gastar créditos reales de Tavily/LLM/ElevenLabs en pruebas automáticas: los tests usan mocks.
8. Antes de cerrar un cambio: `pnpm typecheck` y `pnpm test` en verde.

## Stack

TypeScript (Node 22.13+, ejecutado con `tsx`, sin build), pnpm, Hono, Zod, `node:sqlite`, Vitest, Docker.

- **LLM intercambiable** (`LLM_PROVIDER`): `mock`, `gemini` (por defecto en real) y `groq`, con *tool use*. Interfaz en `src/agent/llm.ts`.
- **Puntaje determinista** en `src/agent/scoring.ts` (0–100 con razones). El LLM decide cuándo puntuar y lo explica, pero no inventa el número; `/match` usa el mismo cálculo.
- **Memoria:** AtomicMemory (Cloud o Docker local). Si cae, el agente sigue con SQLite.
- **Descubrimiento:** Tavily (búsqueda y enriquecimiento) y Apify (`apify/cheerio-scraper`) en `src/agent/descubrimiento.ts`, compartido por la herramienta del agente, `pnpm escanear` y `/jobs/escanear`.
- **Canal:** Telegram directo (`src/channels/telegram.ts`), con voz por ElevenLabs.
- **Regla de oro:** el cerebro es el servidor del agente. Telegram solo transporta, n8n solo dispara, Maritime solo aloja.

## Decisiones que no son obvias

| Tema | Decisión | Motivo |
| --- | --- | --- |
| SQLite | `node:sqlite` en vez de `better-sqlite3` | Evita compilar módulos nativos en Windows y Docker. |
| Historial | La sesión guarda solo texto, no las llamadas a herramientas | Contexto corto y sin problemas al cambiar de proveedor. "La 3" se resuelve con `ultimaLista`. |
| Gemini | REST `generateContent`; se reenvía el `content` original del modelo | Conserva las *thought signatures*. Reintenta 2 veces ante 503/429. |
| Modelos | `gemini-3.8-flash` y `openai/gpt-oss-120b` (Groq) por defecto | Si el modelo está saturado o retirado, cambiar `LLM_MODEL` o usar Groq. |
| AtomicMemory | `POST /v1/memories/ingest`, `/search` y `GET /list` con `Bearer`; extrae hechos en inglés, por eso el puntaje reconoce también "not interested" | Verificado contra la imagen 1.2.2. Cloud y local usan la misma API. |
| Tavily | `search_depth: basic`, `country: peru`, `exclude_domains` con bolsas de empleo y redes | Sin excluirlas devuelve páginas de búsqueda de Indeed/LinkedIn, que no son ofertas. |
| Extracción | De texto libre a oportunidad con heurísticas deterministas (`src/util/extraer.ts`), no con el LLM | Sin tokens, testeable sin red. Si no es seguro, el campo queda vacío; las vencidas se descartan. |
| Apify | `run-sync-get-dataset-items` con un `pageFunction` genérico; `proxyConfiguration` es obligatorio y hay que aprobar los permisos del actor una vez | Una página por fuente, frecuencia baja, solo páginas públicas. |
| Telegram | Webhook propio con `secret_token`; `setWebhook` automático al arrancar con `PUBLIC_URL`; audio por bytes | Un bot solo puede tener un webhook. Solo los IDs de `ALLOWED_SENDERS` pueden hablar con el agente. |
| Webhook | Responde 200 de inmediato y el agente corre en segundo plano (`src/mensajeria.ts`); se deduplica por id | El LLM puede tardar más de lo que el proveedor espera. |
| Formato | Las respuestas del LLM se pasan a texto plano y se parten en trozos de 3500 caracteres | El LLM escribe Markdown que Telegram no renderiza igual. |
| Voz | TTS mp3 64 kbps, texto acortado a ~900 caracteres sin enlaces ni emojis | El plan Free de ElevenLabs da 10,000 créditos/mes y no permite voces de la biblioteca por API (se usa una predeterminada). |
| Avisos | Lógica en `src/jobs.ts`; tabla `avisos (oportunidad_id, tipo)` para no repetir | n8n solo dispara. Solo avisa lo que supera `NOTIFY_MIN_SCORE`. |
| Tokens | `API_TOKEN`, `PANEL_TOKEN` (solo `GET /api/*`), `JOBS_TOKEN` y `MATCH_TOKEN`; comparación en tiempo constante | Un token en el navegador no debe permitir hablar con el agente ni gastar cuota. |
| Maritime | No reenvía `Authorization` y su borde rechaza el preflight CORS: los tokens también van en `X-Radar-Token` y el panel usa `?token=` | Probado en producción. |
| Maritime | Datos en `/data`; el Dockerfile arranca con `tsx` directo (no `pnpm start`); `.env.prod` sin BOM y con `PORT=3000` | `pnpm start` hacía que corepack descargara pnpm al iniciar y la URL daba 502. |
| `/match` | Acepta forma anidada y plana, `POST` y `GET`; 404 si falta el token | Lo que pide la guía de Qatom. |
| Panel | Solo lectura | Escribir desde un navegador público exigiría exponer un token con permisos de escritura; el estado se cambia por el chat. |
| pnpm 11 | `allowBuilds: esbuild: true` en `pnpm-workspace.yaml` | Sin esto, `pnpm install` falla. |
| Zavu | Se descartó como canal | Entregaba las notas de voz de Telegram como texto vacío y su plan Free no ofrece alternativa útil para avisos. |

## Pendiente

- Probar el "sleep" de Maritime tras 20+ min sin uso.
- Compra de prueba en Qatom (método y cuerpo reales que envía).
- `enriquecer` (Tavily con `include_answer`) y el proveedor Groq: implementados con tests, sin probar con llave real.
- Resumen semanal hablado por `/jobs`: sin probar de punta a punta con audio.
