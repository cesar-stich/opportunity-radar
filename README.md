# 📡 Radar

Agente que busca oportunidades (prácticas, becas, hackathones, convocatorias y cursos), las puntúa según tu perfil y tu feedback, y te avisa por WhatsApp. Es un proyecto de práctica para **Hack the Andes 2026**. Ver [CLAUDE.md](CLAUDE.md) para el plan completo y el estado actual.

## Arrancar (sin llaves, todo en mock)

```bash
pnpm install
pnpm seed        # 15 oportunidades ficticias en data/radar.db
pnpm dev         # http://localhost:3000
pnpm test        # tests con Vitest
```

Prueba (en Windows usa un archivo UTF-8 si las tildes llegan mal: `--data-binary @pregunta.json`):

```bash
curl -X POST localhost:3000/ask -H "content-type: application/json" -d '{"text":"que hay para practicas?"}'
curl -X POST localhost:3000/ask -H "content-type: application/json" -d '{"text":"descarta la 3, no me interesa Lima Norte"}'
curl -X POST localhost:3000/ask -H "content-type: application/json" -d '{"text":"preparame el mensaje para postular a la primera"}'
```

## Activar el cerebro real (gratis)

1. Crea tu llave en https://aistudio.google.com/apikey (capa gratuita de Gemini, sin tarjeta).
2. `cp .env.example .env` y pon `LLM_PROVIDER=gemini` y `GEMINI_API_KEY=...`.
3. Alternativa: Groq (https://console.groq.com/keys) con `LLM_PROVIDER=groq`.

Para volver al modo sin llaves, pon `LLM_PROVIDER=mock`.

## Memoria real (AtomicMemory, Fase 2)

Requiere Docker Desktop corriendo y `GROQ_API_KEY` en `.env` (AtomicMemory la usa para extraer hechos).

```bash
docker compose up -d                 # Postgres+pgvector y AtomicMemory en http://localhost:17350
curl localhost:17350/health          # {"status":"ok"}
```

Luego pon `MEMORY_MODE=real` en `.env`. Costo cero: embeddings locales (MiniLM) y Groq `gpt-oss-120b`, sin OpenAI. Para apagarlo: `docker compose down` (los recuerdos se conservan en el volumen `pgdata`).

## Descubrimiento (Fase 3: Tavily + Apify)

- **Tavily** (búsqueda abierta): crea tu llave gratis en https://app.tavily.com (1,000 créditos/mes, sin tarjeta; cada búsqueda cuesta 1) y ponla en `TAVILY_API_KEY`, con `TAVILY_MODE=real`.
- **Apify** (portales sin API): crea tu cuenta en https://console.apify.com/sign-up (plan Free, US$5/mes, sin tarjeta), copia el token de https://console.apify.com/settings/integrations en `APIFY_TOKEN` y pon `APIFY_MODE=real`. La primera vez Apify te pide **aprobar una vez** los permisos del actor `apify/cheerio-scraper` (el error trae el enlace).

```bash
pnpm fuentes                       # lista las fuentes (tabla `fuentes`); `pnpm fuentes desactivar 3` / `activar 3`
pnpm escanear                      # recorre las fuentes activas (Tavily + Apify) y guarda lo nuevo
pnpm escanear "becas cloud Perú"   # búsqueda puntual en Tavily
```

Por chat: *"busca prácticas de telecomunicaciones en Lima"* (herramienta `buscar_oportunidades`), *"escanea las fuentes"* o *"investiga la 2"* (`enriquecer_oportunidad`). Todo se deduplica por URL y por título + organización.

## Canal de mensajería (Fase 4: Telegram directo)

**Canal activo: Telegram directo** (`CHANNEL=telegram`, `src/channels/telegram.ts`). Se eligió porque es gratis, sin ventana de 24 h y, sobre todo, porque **recibe notas de voz**. Zavu entrega las notas de voz de Telegram como mensajes de texto vacío (verificado en su webhook y en su API), así que quedó como alternativa (ver abajo).

1. **Bot:** en Telegram habla con [@BotFather](https://t.me/BotFather), `/newbot`, guarda el token.
2. **URL pública:** en local usa un túnel (`winget install Cloudflare.cloudflared` y `cloudflared tunnel --url http://localhost:3000`); en producción, la URL de Maritime.
3. **.env:**

```
CHANNEL=telegram
TELEGRAM_BOT_TOKEN=…            # el de BotFather
TELEGRAM_WEBHOOK_SECRET=…       # inventa uno: letras, números, _ o - (openssl rand -hex 24)
PUBLIC_URL=https://TU-URL
ALLOWED_SENDERS=                # vacío al principio
```

4. `pnpm dev`: al arrancar registra solo el webhook en Telegram (`setWebhook` con tu `PUBLIC_URL` y el secreto). Escríbele "hola" al bot: te responde con **tu ID** (chat id). Ponlo en `ALLOWED_SENDERS`, reinicia y listo. Solo ese ID puede usar el agente (el bot es público y cada pregunta gasta cuota de Tavily y del LLM).

> Un bot de Telegram solo puede tener **un** webhook. Si dos servidores (por ejemplo tu laptop y Maritime) arrancan con el mismo token, se pisan el webhook. Para desarrollar en local mientras Maritime sigue activo, crea un segundo bot en BotFather.

**Alternativa: Zavu** (`CHANNEL=zavu-telegram` o `zavu-whatsapp`, `ZAVU_MODE=real`, `ZAVU_API_KEY`, `ZAVU_WEBHOOK_SECRET`, webhook `/webhook/zavu`). Funciona para texto. Límites del plan Free (doc del 2026-10-16): 2,000 mensajes/mes entre WhatsApp y Telegram; SMS a Perú US$0.235 c/u (crédito de US$2), llamadas desde US$0.07/min, email solo con dominio propio. WhatsApp pide un número que no esté en WhatsApp.

## Avisos automáticos (Fase 6: n8n)

El agente avisa **solo** lo que vale la pena (puntaje ≥ `NOTIFY_MIN_SCORE`, 70 por defecto) y nunca repite un aviso. Los avisos llegan al primer ID de `ALLOWED_SENDERS`. n8n solo dispara; la lógica está en `src/jobs.ts`.

| Job | Qué hace | Cron (Lima) |
| --- | --- | --- |
| `POST /jobs/escanear` | Recorre las fuentes activas y avisa las nuevas que superan el umbral | `0 8 * * *` |
| `POST /jobs/recordar-plazos` | Avisa una vez lo que te interesa (o puntúa alto) y cierra en ≤ 3 días | `0 9 * * *` |
| `POST /jobs/resumen-semanal` | Resumen de las mejores y cuántas cierran en 7 días | `0 19 * * 0` |

Cada job exige el token en `Authorization: Bearer $JOBS_TOKEN` o en `X-Radar-Token: $JOBS_TOKEN` (en Maritime solo funciona la segunda: su URL pública no reenvía `Authorization`) y responde `{ ok, avisados, detalle }`; si no hay a quién avisar responde 409. Tras un aviso puedes contestar "descarta la 2" y se entiende a cuál te refieres.

Probar sin n8n (mock): `curl -X POST localhost:3000/jobs/escanear -H "authorization: Bearer $JOBS_TOKEN"`.

**n8n (gratis, self-hosted o Cloud con trial):** importa `n8n/*.json` (Workflows → Import from File). En cada uno cambia en el nodo HTTP la URL `https://TU-URL-PUBLICA` por la de tu servidor y `CAMBIA_ESTE_TOKEN` por tu `JOBS_TOKEN` (la cabecera es `X-Radar-Token`). Verificado en n8n Cloud: los 3 se ejecutan y publican, y **publica** el workflow (si no, el cron no corre). La zona horaria ya está en `America/Lima`. n8n necesita llegar a tu servidor por internet: con el túnel en local o con la URL de Maritime (Fase 7).

## Voz (Fase 5: ElevenLabs)

Nota de voz → texto (STT `scribe_v2`) → agente → (con `REPLY_AS_VOICE=true`) audio de respuesta (TTS `eleven_multilingual_v2`, mp3 de 64 kbps). El resumen semanal también sale hablado. Si la voz falla, siempre llega la respuesta por texto.

1. Crea una cuenta en https://elevenlabs.io (plan Free: 10,000 créditos/mes; la doc pública no aclara si incluye API ni si pide tarjeta: **si te la pide, no la actives**).
2. API key en elevenlabs.io → Developers → API Keys, y el ID de una voz en Voices (una que hable bien español).
3. `.env`: `VOICE_MODE=real`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `REPLY_AS_VOICE=true` . Con Telegram directo el audio sale por bytes (no hace falta URL pública); `PUBLIC_URL` solo la necesita Zavu, que baja el audio de `/audio/<nombre-aleatorio>`. Free no puede usar voces de la biblioteca por API (error 402): usa una voz predeterminada, p. ej. Roger (`CwhRBWXzGAHq8TQ4Fs17`).
4. Para ahorrar créditos, lo que se pronuncia se acorta a ~900 caracteres y se omiten enlaces y emojis (siguen en el texto).

## Panel y monetización (Fase 8)

- **Panel (Lovable):** prompt listo en [dashboard/PROMPT.md](dashboard/PROMPT.md). Usa `PANEL_TOKEN` (solo lee `/api/*`) en la URL, `?token=…`: el borde de Maritime rechaza el preflight CORS, así que no puede mandar cabeceras propias. Verificado con datos reales.
- **Qatom:** guía en [deploy/qatom.md](deploy/qatom.md) para publicar `/match` (puntaje 0–100 por llamada). Con `MATCH_TOKEN` el endpoint responde 404 sin el token (cabecera `X-Radar-Token` en Maritime). Ítem "Radar Match" creado en Qatom (precio 0).

## Despliegue (Fase 7: Maritime)

`Dockerfile` listo (Node 24, SQLite en `/data`). Guía paso a paso en [deploy/maritime.md](deploy/maritime.md): repo en GitHub → `maritime create radar --repo … --public --port 3000` → variables con `maritime env import` → `PUBLIC_URL` con la URL del agente (el bot registra solo su webhook) y esa URL en los workflows de n8n. Desplegado y verificado. En producción (`NODE_ENV=production`) `/ask`, `/chat` y `/api/*` exigen `X-Radar-Token: $API_TOKEN` (la URL pública no tiene login ni reenvía `Authorization`). Importante: `.env.prod` se escribe **sin BOM** y con `PORT=3000`; el Dockerfile arranca con `tsx` directo.

Probar la imagen en local: `docker build -t radar . && docker run --rm -p 3000:3000 -e API_TOKEN=x radar` y `curl localhost:3000/health`.

## Rutas

| Ruta | Qué hace |
| --- | --- |
| `POST /chat` `{ message, source? }` | Contrato de Maritime para contenedores propios; devuelve `{ response }` (mismo token que `/ask`) |
| `GET /health` | Muestra qué integraciones están en mock y cuáles en real |
| `POST /ask` `{ text, usuario? }` | Conversa con el agente |
| `POST /match` (o `GET`) | Puntaje 0–100 y razones para Qatom. Forma anidada `{ oportunidad, perfil? }` o plana (`titulo`, `tipo`, `intereses`…). Con `MATCH_TOKEN` exige Bearer |
| `GET /audio/<archivo>` | Audios que Zavu descarga para enviarlos (nombre aleatorio de 128 bits) |
| `GET /api/oportunidades?estado=&tipo=` | Lista para el panel |
| `GET /api/postulaciones`, `GET /api/estadisticas` | Datos para el panel |
| `POST /jobs/{escanear,recordar-plazos,resumen-semanal}` | Disparadores de n8n (requieren `Authorization: Bearer $JOBS_TOKEN`) |
| `POST /webhook/telegram` | Mensajes de Telegram directo (secreto `X-Telegram-Bot-Api-Secret-Token`). Contesta 200 al instante y responde en segundo plano |
| `POST /webhook/zavu` | Mensajes entrantes de Zavu (firma `X-Zavu-Signature` obligatoria). Contesta 200 al instante y responde en segundo plano |

## Estado

| Integración | Estado |
| --- | --- |
| LLM mock / Gemini / Groq | ✅ mock probado · Gemini y Groq implementados, falta probarlos con llave |
| SQLite (`node:sqlite`) | ✅ |
| AtomicMemory | ✅ real con Docker (probado: recuerda descartes tras reiniciar) · mock en RAM |
| Tavily | ✅ real probado con Gemini (búsqueda, plazos, sin duplicados) · mock sin llave |
| Apify | ✅ real probado con `apify/cheerio-scraper` en PRONABEC y OSIPTEL · mock sin llave |
| Telegram directo | ✅ real en producción: texto y notas de voz |
| ElevenLabs | ✅ real: STT y TTS (voz predeterminada Roger) |
| Zavu | texto probado en real; no entrega notas de voz de Telegram → alternativa, no activo |
| Maritime | ✅ desplegado (`radar`), sin tu laptop |
| n8n Cloud | ✅ 3 workflows ejecutados y publicados |
| Lovable | ✅ panel con datos reales |
| Qatom | ✅ ítem publicado · falta una compra de prueba |

## Pendiente

- **Rotar llaves** que se pegaron en el chat durante las pruebas (Zavu, ElevenLabs, token del bot de Telegram, secreto del webhook de Zavu) y actualizar `.env` y `maritime env import`.
- **Sleep de Maritime:** probar que el agente despierta tras 20+ min sin uso.
- **Qatom:** compra de prueba desde un agente comprador; falta ver el método y el cuerpo exactos que manda Qatom.
- `enriquecer` (Tavily con `include_answer`) y Groq: implementados con tests, sin probar con llave real.
- Tavily devuelve sobre todo portales agregadores y la mayoría sale **sin plazo**: es un límite de la fuente, no se inventa la fecha.
- Los portales de Apify se leen con un `pageFunction` genérico; un portal con JavaScript pesado necesitaría otro actor (p. ej. Playwright).
- El resumen semanal hablado por `/jobs` no se probó de punta a punta con audio.
