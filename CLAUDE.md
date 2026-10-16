# Proyecto: "Radar" — agente cazador de oportunidades para estudiantes

> **Documento vivo.** Este archivo es la fuente de verdad del proyecto y Claude lo mantiene al día (regla 9).
> Para saber dónde estamos, lee primero la **sección 11 (Estado y decisiones)**.

## 1. Contexto y objetivo

Soy Cesar, estudiante de Ingeniería de Telecomunicaciones en la UNI (Lima). Voy al hackathon **Hack the Andes** (Lima, 17–18 oct 2026, 30 horas, equipos de 1–4). Los tracks se revelan el 17 y no sé si habrá dataset. Este proyecto es de **práctica real**: quiero aprender qué hace cada herramienta sponsor construyendo algo que yo mismo usaré, y que sea una base reutilizable en el hackathon.

**Producto:** un agente que, por su cuenta y todos los días, busca oportunidades (prácticas, becas, hackathones, convocatorias, cursos), las compara con mi perfil, y me avisa por WhatsApp solo las que valen la pena, con plazo y un borrador de postulación. También puedo escribirle o mandarle una nota de voz:
- "¿qué hay para prácticas en banca?"
- "descarta esa, no me interesa Lima Norte"
- "prepárame el mensaje para postular a la segunda"
- "dame el resumen de la semana en audio"

**Qué lo hace un agente (no un chatbot):**
- *Proactivo:* escanea y avisa sin que yo pregunte.
- *Con herramientas:* decide si buscar en la web, scrapear una página, consultar su memoria o su base.
- *Con memoria:* aprende de mi feedback (qué descarto, qué acepto) y mejora el filtro.
- *Con acciones:* guarda el estado de cada oportunidad, genera borradores, programa recordatorios.

**Objetivo de aprendizaje:** cada herramienta tiene un rol único y yo entiendo por qué existe. Prioridad: que funcione de extremo a extremo con una demo clara, no que sea perfecto.

## 2. Reglas de trabajo para Claude Code

1. **Antes de integrar cada servicio, lee su documentación oficial actual** (URLs en la sección 5). No asumas nombres de endpoints ni de SDK: verifica. Si algo no coincide con este documento, gana la documentación y me avisas.
2. **Modo mock primero.** Cada integración va detrás de una interfaz (`src/interfaces.ts`) con implementación `mock` y `real`, elegida por variable de entorno. Todo debe correr local sin llaves y yo activo servicios uno a uno.
3. Trabaja **por fases** (sección 6). Al terminar cada fase: tests básicos pasando, README actualizado, commit, y me dices en 3 líneas qué quedó funcionando y qué sigue.
4. **Nunca** subas llaves a git. Mantén `.env.example` actualizado y `.env` en `.gitignore`.
5. Código simple y legible, sin sobreingeniería. Comentarios breves en español explicando el "por qué" de cada integración.
6. **Presupuesto cero.** Todo se prueba con planes gratuitos. Si una herramienta requiere pago o tarjeta, **no la actives**: déjala en mock y avísame. Al empezar cada fase dime qué cuenta gratuita necesito crear y qué límite tiene.
7. No crees cuentas ni pegues credenciales por mí; dime qué llave necesito y dónde obtenerla.
8. **Las postulaciones nunca se envían solas.** El agente solo genera borradores y yo envío. Ninguna acción con efecto externo sin mi confirmación explícita por WhatsApp.
9. **Mantén vivo este CLAUDE.md.** Al cerrar cada fase, o cuando una decisión cambie el plan (stack, servicio, alcance, orden de fases), edita las secciones afectadas y anota el cambio con su motivo en la sección 11. Si la documentación de un servicio contradice este archivo, corrige el archivo. No hace falta pedirme permiso para estos cambios, pero sí mencionármelos en el resumen de la fase.

## 3. Stack

- **Lenguaje:** TypeScript (Node 22.13+; probado con Node 24), `pnpm`. Se ejecuta con `tsx` (sin paso de build).
- **Servidor del agente:** Hono con rutas `/webhook/zavu`, `/ask`, `/match`, `/jobs/*`, `/api/*`, `/health`.
- **Validación:** Zod.
- **LLM (cerebro), intercambiable:** interfaz `LLMProvider` en `src/agent/llm.ts` con *tool use* (function calling). Proveedores: `gemini` (por defecto, usar su capa gratuita de Google AI Studio), `groq` (capa gratuita) y `anthropic` (de pago, opcional). Se elige con `LLM_PROVIDER` y `LLM_MODEL`. **Verifica en la documentación oficial que la capa gratuita siga vigente y soporte function calling**; si no, dime y buscamos otra. El `mock` entiende frases típicas con reglas y llama a las mismas herramientas, para correr sin llaves. **No actives ningún proveedor de pago.** Modelos por defecto: `gemini-3.8-flash` (Gemini) y `openai/gpt-oss-120b` (Groq).
- **Puntaje:** determinista en `src/agent/scoring.ts` (perfil + feedback + memoria → 0–100 con razones). El LLM decide cuándo puntuar y lo explica, pero no inventa el número. El mismo cálculo sirve para `/match`.
- **Datos estructurados:** SQLite nativo de Node (`node:sqlite`, sin dependencias nativas): tablas `fuentes`, `oportunidades`, `postulaciones`, `feedback`.
- **Memoria semántica:** AtomicMemory (perfil, preferencias, aprendizajes de mi feedback).
- **Tests:** Vitest. **Contenedores:** Docker.

## 4. Rol de cada herramienta (sin solapamientos)

| Herramienta | Rol único | Código |
| --- | --- | --- |
| **Apify** | Scraping de portales de convocatorias sin API (lista de fuentes en `fuentes`). | `src/tools/apify.ts` |
| **Tavily** | Búsqueda abierta: descubrir oportunidades nuevas y enriquecer cada una (empresa, requisitos, noticias). | `src/tools/tavily.ts` |
| **AtomicMemory** | Memoria a largo plazo: mi perfil, gustos y feedback ("descarté X porque Y"). El agente la consulta antes de puntuar. | `src/memory/atomicmemory.ts` |
| **Zavu** | Canal de mensajería: **WhatsApp es la prioridad**; recibe y envía mensajes y audios. Solo transporta. Si WhatsApp no se puede probar gratis, se usa **Telegram** (Zavu lo soporta; si tampoco, bot de Telegram directo) sin cambiar el resto. | `src/channels/` |
| **ElevenLabs** | Voz: transcribir notas de voz (STT) y generar audios (TTS), incluido el resumen semanal hablado. | `src/voice/elevenlabs.ts` |
| **n8n** | Solo disparadores programados: llama a `/jobs/escanear`, `/jobs/resumen-semanal`, `/jobs/recordar-plazos`. | `n8n/*.json` |
| **Maritime** | Hosting del servidor del agente en micro-VM. | `deploy/maritime.md` |
| **Qatom** | Publicar `/match` como servicio de pago por llamada: recibe un perfil y una oportunidad y devuelve puntaje y razones. | `deploy/qatom.md` |
| **Lovable** | Panel web tipo kanban (nueva → interesa → postulada → respondida) que consume `/api/*`. | `dashboard/PROMPT.md` |

Regla de oro: **el cerebro es el servidor del agente**. Zavu solo transporta, n8n solo dispara, Maritime solo aloja.

## 5. Documentación a leer antes de cada fase

- Zavu: https://docs.zavu.dev/introduction.md y https://docs.zavu.dev/quickstart (canales, webhooks, CLI, SDK). Verificar plan gratis/sandbox y reglas de mensajes proactivos en WhatsApp (plantillas). Si los proactivos fallan, usar SMS o Telegram para los avisos.
- AtomicMemory: https://github.com/atomicstrata (core HTTP con Postgres+pgvector en Docker, SDK `@atomicmemory/sdk`, CLI). Developer Preview: la API puede cambiar.
- Maritime: https://maritime.sh/docs (`maritime deploy`, `git push maritime main`, Docker, SDKs).
- Qatom: https://qatom.ai (plan Free: 1 agente, 5 ítems de catálogo, 25 transacciones/mes).
- LLM gratuito: documentación oficial de Google AI Studio (Gemini API) y de Groq; verificar límites gratis y function calling.
- Tavily: https://docs.tavily.com (plan gratis 1,000 créditos/mes).
- Apify, n8n, ElevenLabs: documentación oficial (verificar límites del plan gratis).

## 6. Fases

**Fase 0 — Esqueleto (sin llaves)**
Estructura, TypeScript, Hono, Zod, Vitest, SQLite con las 4 tablas, interfaces y mocks de todas las integraciones, `profile.json` con mi perfil (ver sección 8). Ruta `/ask` que recibe `{ text }`. Criterio: `pnpm dev` y un `curl` a `/ask` responde.

**Fase 1 — Cerebro con herramientas**
Bucle con el LLM elegido en `LLM_PROVIDER` y *tool use*. Herramientas: `listar_oportunidades`, `puntuar_oportunidad` (0–100 con razones, según perfil y feedback), `cambiar_estado`, `registrar_feedback`, `redactar_borrador`. Prompt de sistema en español peruano, tono cercano y breve. Incluir `seed.ts` con ~15 oportunidades ficticias para probar sin scraping (`pnpm seed`). Criterio: "¿qué hay para prácticas?" lista y puntúa; "descarta la 3, no me interesa" guarda feedback.

**Fase 2 — Memoria**
`MemoryStore` real con AtomicMemory (Docker Compose con core + Postgres/pgvector). Guardar perfil y feedback; recuperarlos antes de puntuar. Criterio: tras reiniciar, el agente recuerda que descarté un tipo de oferta y baja su puntaje.

**Fase 3 — Descubrimiento**
`fuentes` configurables. Apify: scrapear 1–2 portales públicos de convocatorias (usar un actor existente o uno genérico de crawler). Tavily: `buscar_oportunidades(query)` y `enriquecer(oportunidad)`. Deduplicar por URL y título. Criterio: aparecen oportunidades reales con enlace y plazo.

**Fase 4 — Canal de mensajería (WhatsApp primero, Telegram de respaldo)**
Define una interfaz `Channel` (`recibir`, `enviarTexto`, `enviarAudio`) con implementaciones `zavu-whatsapp`, `zavu-telegram` y `mock`, elegida con `CHANNEL`. Orden de intento:
1. Intentar WhatsApp con Zavu. Verifica en su documentación: plan gratis o sandbox, si requiere verificación de negocio, costo por mensaje y reglas de plantillas para mensajes proactivos.
2. Si WhatsApp exige pago o verificación que no puedo cumplir, **cambia a Telegram** (por Zavu o con un bot directo) y avísame en una línea.
Webhook `/webhook/zavu` (o `/webhook/telegram`), enviar y recibir texto, verificar firma si hay. Criterio: conversación real por el canal activo y confirmación explícita antes de cualquier acción con efecto.

**Fase 5 — Voz**
Nota de voz entrante → STT → agente → TTS → audio saliente. Interruptor `REPLY_AS_VOICE`. Criterio: audio entra, audio sale.

**Fase 6 — Automatización con n8n**
Rutas `/jobs/*` protegidas por `JOBS_TOKEN`. Workflows exportados en `n8n/` con cron: escaneo diario, resumen semanal en audio, recordatorio de plazos (3 días antes). El agente solo avisa si el puntaje supera un umbral (`NOTIFY_MIN_SCORE`). Criterio: me llega un aviso sin que yo escriba.

**Fase 7 — Despliegue**
`Dockerfile`, `deploy/maritime.md` y despliegue en Maritime. Actualizar webhooks de Zavu y n8n a la URL pública. Criterio: todo funciona sin mi laptop.

**Fase 8 — Panel y monetización**
Endpoints de solo lectura `/api/oportunidades`, `/api/postulaciones`, `/api/estadisticas`. `dashboard/PROMPT.md` con el prompt para generar el kanban en Lovable. Ruta `/match` y guía `deploy/qatom.md` para publicarla en Qatom (plan Free). Criterio: el panel muestra datos reales y `/match` aparece en Qatom.

## 7. Variables de entorno (`.env.example`)

```
PORT=3000
DB_PATH=data/radar.db
LLM_PROVIDER=mock        # mock | gemini | groq | anthropic (solo de pago)
LLM_MODEL=               # vacío = default del proveedor
GEMINI_API_KEY=
GROQ_API_KEY=
ANTHROPIC_API_KEY=
CHANNEL=mock             # mock | zavu-whatsapp | zavu-telegram
TELEGRAM_BOT_TOKEN=
ZAVU_API_KEY=
ZAVU_WEBHOOK_SECRET=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ATOMICMEMORY_URL=https://api.atomicstrata.ai   # Cloud; local con Docker: http://localhost:17350
ATOMICMEMORY_API_KEY=
TAVILY_API_KEY=
APIFY_TOKEN=
JOBS_TOKEN=
NOTIFY_MIN_SCORE=70
# Interruptores: mock | real
ZAVU_MODE=mock
VOICE_MODE=mock
MEMORY_MODE=mock
TAVILY_MODE=mock
APIFY_MODE=mock
REPLY_AS_VOICE=false
```

## 8. Perfil inicial (`profile.json`)

```json
{
  "nombre": "Cesar",
  "estudios": "Ingeniería de Telecomunicaciones, UNI (FIEE), Lima",
  "certificaciones": ["Huawei HCIA-AI V4.0", "Huawei HCIA-Cloud Service V3.5"],
  "experiencia": ["Director de Relaciones Públicas, IEEE CIS UNI (talleres, curso de Machine Learning, hackathon HackCIS)"],
  "busca": ["prácticas pre-profesionales", "hackathones", "becas", "cursos de IA y cloud"],
  "intereses": ["IA", "machine learning", "cloud", "telecomunicaciones", "datos"],
  "ubicacion": "Lima, Perú",
  "idioma": "español"
}
```

## 9. Estructura de carpetas

La raíz del repo es esta carpeta (no hay subcarpeta `radar/`).

```
./
├── CLAUDE.md
├── README.md
├── profile.json
├── .env.example
├── docker-compose.yml        # AtomicMemory core + Postgres/pgvector (Fase 2)
├── src/
│   ├── index.ts              # arranque del servidor
│   ├── app.ts                # rutas Hono (testeables sin levantar puerto)
│   ├── config.ts             # lectura y validación del .env con Zod
│   ├── deps.ts               # elige mock o real para cada integración según el .env
│   ├── interfaces.ts         # contratos de todas las integraciones
│   ├── types.ts              # tipos y esquemas Zod del dominio
│   ├── agent/                # bucle (agent.ts), prompt, tools, scoring, llm.ts + providers/
│   ├── db/                   # SQLite (index.ts), consultas (repo.ts), seed.ts
│   ├── channels/zavu.ts      # mock + real en el mismo archivo (igual en voice/, memory/, tools/)
│   ├── voice/elevenlabs.ts
│   ├── memory/atomicmemory.ts
│   ├── tools/{tavily,apify}.ts
│   └── util/texto.ts
├── n8n/
├── deploy/{maritime.md,qatom.md}
├── dashboard/PROMPT.md
└── tests/
```

## 10. Notas finales

- Si en el hackathon cambia el reto, lo reutilizable es: interfaces y mocks, memoria, canal WhatsApp, voz, automatizaciones y despliegue. Lo que cambia es la fuente (Apify/Tavily o un dataset cargado) y las herramientas de negocio de `src/agent/`.
- Respetar los términos de uso de cada portal al scrapear: solo páginas públicas, con frecuencia baja.
- Si algo bloquea más de 20 minutos (por ejemplo una API en preview que cambió), déjalo en mock, anótalo en `README.md` en "Pendiente" y sigue con la siguiente fase.

## 11. Estado y decisiones (lo actualiza Claude)

**Hoy: 2026-10-16. El hackathon empieza mañana (17 oct).** Prioridad: lo que más se reutiliza y se demuestra.

### Fases

- [x] **Fase 0 — Esqueleto** (2026-10-16)
- [x] **Fase 1 — Cerebro con herramientas** (2026-10-16): funciona con el LLM mock y con **Gemini real** (probado el 2026-10-16). Groq está implementado pero falta probarlo con llave.
- [x] **Fase 2 — Memoria** (2026-10-16): AtomicMemory real. **Modo activo: Cloud** (api.atomicstrata.ai, plan Basic: 10,000 operaciones/mes; ingest = 3, search = 1). Probado en local (Docker) y en Cloud: después de reiniciar, con SQLite vacío, una oferta nueva en "Lima Norte" baja de 76 a 46.
- [x] **Fase 3 — Descubrimiento** (2026-10-16): **Tavily real** probado con Gemini (`buscar_oportunidades`: guarda, puntúa y no duplica al repetir) y **Apify real** (`apify/cheerio-scraper`) probado en PRONABEC y OSIPTEL. `enriquecer` implementado con tests, sin probar con llave real. 27 tests.
- [x] **Fase 4 — Canal** (2026-10-16): `ZavuChannel` (Telegram por defecto, WhatsApp con `CHANNEL=zavu-whatsapp`) con firma `X-Zavu-Signature`, dedupe, respuesta en segundo plano y dueño único (`ALLOWED_SENDERS`). 44 tests sin red. **Falta la prueba con la cuenta real de Zavu** (pasos en el README): hasta entonces el criterio "conversación real" no está verificado.
- [ ] Fase 5 — Voz (ElevenLabs)
- [ ] Fase 6 — n8n (`/jobs/*` ya exige `JOBS_TOKEN`; hoy responde 501)
- [ ] Fase 7 — Despliegue (Maritime)
- [ ] Fase 8 — Panel y monetización (`/api/*` y `/match` ya funcionan; faltan `dashboard/PROMPT.md` y `deploy/qatom.md`)

### Orden sugerido (cambio respecto al plan original)

Siguiente: 1) Probar la Fase 4 con la cuenta real de Zavu → 2) Fase 6 (avisos; `/jobs/escanear` ya puede llamar a `descubrir()`) → 3) Fase 5 (voz) → 4) Fases 7 y 8.

### Decisiones tomadas

| Fecha | Decisión | Motivo |
| --- | --- | --- |
| 2026-10-16 | `node:sqlite` en vez de `better-sqlite3` | Evita compilar módulos nativos en Windows o Docker; viene con Node 22.13+. |
| 2026-10-16 | Gemini por REST `generateContent` (modelo por defecto `gemini-3.8-flash`) | Según la doc del 2026-10-16 tiene capa gratis y function calling. Se reenvía el `content` original del modelo para conservar las *thought signatures*. Google también ofrece la nueva Interactions API, pero no hace falta. |
| 2026-10-16 | Groq por su API compatible con OpenAI (modelo por defecto `openai/gpt-oss-120b`) | Doc de tool use verificada el 2026-10-16. |
| 2026-10-16 | Puntaje determinista, no hecho por el LLM | Es testeable, no gasta tokens y `/match` usa el mismo cálculo. |
| 2026-10-16 | El historial de sesión guarda solo texto (no las llamadas a herramientas) | Contexto corto y sin problemas al cambiar de proveedor. "La 3" se resuelve con `ultimaLista` de la sesión. |
| 2026-10-16 | Llave de Gemini probada: funciona con herramientas. En `.env`: `LLM_MODEL=gemini-3.5-flash-lite` | `gemini-3.8-flash` daba 503 (saturado) y `gemini-2.5-flash` ya no está disponible para usuarios nuevos (404). El proveedor reintenta 2 veces ante 503/429. Si sigue saturado, usar Groq de respaldo. |
| 2026-10-16 | AtomicMemory: `docker-compose.yml` propio, basado en el oficial, con `EMBEDDING_PROVIDER=transformers` (MiniLM, 384 dim) y `LLM_PROVIDER=groq` / `openai/gpt-oss-120b` | Por defecto usa OpenAI (de pago). `llama-3.1-8b-instant` (el de su doc) ya no existe en Groq, y `gpt-oss-20b` devolvía JSON inválido. Puerto 17350; Postgres en 5433. |
| 2026-10-16 | API de AtomicMemory verificada contra la imagen 1.2.2: `POST /v1/memories/ingest {user_id, conversation, source_site}`, `POST /v1/memories/search {user_id, query, limit}`, `GET /v1/memories/list`. Auth: `Bearer` con `CORE_API_KEY` | La doc web no traía los esquemas, así que la probé contra el servicio real. Extrae hechos en inglés: el puntaje también reconoce "not interested". Si la búsqueda no encuentra nada, se lee la lista completa. Si la memoria cae, el agente sigue con SQLite. |
| 2026-10-16 | AtomicMemory **Cloud** (`https://api.atomicstrata.ai` + llave `amc_…`) como modo principal; Docker local queda de respaldo | Cesar tiene créditos de AtomicMemory como perk del hackathon. Según la doc, la API `/v1/memories/*` es la misma: solo cambian la URL y la llave, sin cambiar código. No depende de Docker y funciona cuando se despliegue (Fase 7). |
| 2026-10-16 | Tavily: `POST https://api.tavily.com/search`, `Authorization: Bearer`, siempre `search_depth: basic` (1 crédito; `advanced` = 2), `country: peru`, `include_raw_content: markdown` (probado: sigue costando 1 crédito), `exclude_domains` con bolsas de empleo y redes sociales | Doc oficial verificada el 2026-10-16: 1,000 créditos/mes gratis sin tarjeta. Sin excluir dominios, Tavily devuelve páginas de búsqueda de Indeed/LinkedIn/Computrabajo (no son ofertas); al excluirlas salen páginas de convocatorias de instituciones y agregadores. Cada llamada imprime los créditos usados. |
| 2026-10-16 | De texto libre a `OportunidadInput` con **heurísticas deterministas** (`src/util/extraer.ts`), no con el LLM | Lo más simple que funciona: sin tokens, testeable sin red y no depende de que Gemini esté saturado. Plazo = fecha cerca de palabras como "hasta/plazo/cierre" (si el contenido completo tiene más de 2 fechas se considera un listado y queda `null`); tipo por palabras clave; ubicación por lista de ciudades. Si no es seguro, se deja vacío en vez de inventar. Las vencidas se descartan. |
| 2026-10-16 | Apify: actor público `apify/cheerio-scraper` por `POST /v2/actors/apify~cheerio-scraper/run-sync-get-dataset-items` con `Bearer` (la doc usa `/actors/`, no `/acts/`) | Actor gratis (solo se paga el uso de plataforma; Free = US$5/mes sin tarjeta). Sin crear un actor propio: un `pageFunction` genérico lee tarjetas (título + enlace) o filas de tabla. Una sola página por fuente, sin seguir enlaces (frecuencia baja). Requisitos descubiertos al probar: aprobar permisos del actor una vez en la consola (403 `full-permission-actor-not-approved`) y `proxyConfiguration` es obligatorio. |
| 2026-10-16 | Portales de Apify: PRONABEC becas internacionales y OSIPTEL prácticas vigentes | HTML sin JavaScript, `robots.txt` permite o no existe, datos públicos. Sembrados en `fuentes` junto a 3 consultas de Tavily, ahora **activas** (antes inactivas). |
| 2026-10-16 | Descubrimiento en `src/agent/descubrimiento.ts`, compartido por la herramienta `buscar_oportunidades`, `pnpm escanear` y (Fase 6) `/jobs/escanear` | Una fuente caída no detiene a las demás; los errores se avisan en la respuesta. |
| 2026-10-16 | **Canal activo: Telegram vía Zavu**, no WhatsApp | Doc de Zavu (2026-10-16): WhatsApp pide un número que no esté ya en WhatsApp (el plan Free no compra números de Zavu), la sandbox `zv_test_` solo envía a teléfonos del equipo desde un número compartido, y fuera de las 24 h solo se permiten plantillas aprobadas (rompe los avisos proactivos de la Fase 6). Telegram es gratis, sin ventana, y se conecta con el token de @BotFather. Una sola clase sirve para ambos canales. |
| 2026-10-16 | Zavu: `POST https://api.zavu.dev/v1/messages {to,text,channel}` con `Bearer` (+ `Zavu-Sender`); webhook `message.inbound` firmado con `X-Zavu-Signature: t=…,v2=HMAC_SHA256(secreto, "{t}.{cuerpo}")` (v1 = solo cuerpo), tolerancia 300 s / −60 s | Verificado en la doc. Se firma sobre el cuerpo crudo. En Telegram `to` y `data.from` son el chat id numérico. |
| 2026-10-16 | El webhook responde 200 de inmediato y el agente corre en segundo plano (`src/mensajeria.ts`); se deduplica por `data.messageId` | Zavu exige 2xx en 30 s y reintenta (1 min, 5 min, 15 min, 1 h, 4 h); Gemini llegó a tardar 24 s. |
| 2026-10-16 | Solo los IDs en `ALLOWED_SENDERS` pueden hablar con el agente; sin configurar, el bot responde con el ID del que escribe. Con `ZAVU_MODE=real` es obligatorio `ZAVU_WEBHOOK_SECRET` | El bot de Telegram es público: cualquiera podría gastar la cuota de Tavily y del LLM, o falsificar mensajes en el webhook. |
| 2026-10-16 | Respuestas del LLM convertidas a texto plano antes de enviar (`src/util/formato.ts`; WhatsApp conserva `*negrita*`) y partidas en trozos de 3500 caracteres | El LLM escribe Markdown (`**x**`, `[t](url)`) que no se ve igual en cada canal; la doc de Zavu no garantiza su formato en Telegram. |
| 2026-10-16 | Regla 8 (confirmación explícita): hoy **ninguna herramienta tiene efecto externo** (solo borradores y datos internos), así que no hay nada que confirmar todavía | La compuerta de confirmación se agrega cuando exista una acción con efecto (p. ej. enviar un correo). Hasta entonces el prompt prohíbe decir que algo se envió. |
| 2026-10-16 | Pruebas: **no se gastan créditos ni llamadas reales** de Tavily/LLM/Zavu para probar; se integra y se prueba con mocks, y Cesar valida con su cuenta | Indicación de Cesar durante la Fase 4. |
| 2026-10-16 | pnpm 11 exige aprobar los build scripts: `allowBuilds: esbuild: true` en `pnpm-workspace.yaml` | Sin esto, `pnpm install` falla. |

### Sin verificar todavía (se revisa al empezar su fase)

Zavu (sandbox de WhatsApp y plantillas), Maritime, Qatom y ElevenLabs: límites del plan gratis. (Tavily y Apify ya verificados en la Fase 3.)

### Límites conocidos de la Fase 3

Tavily trae sobre todo agregadores y la mayoría de resultados salen sin plazo; los portales de Apify dependen de que su HTML siga igual. Detalle en "Pendiente" del README.
