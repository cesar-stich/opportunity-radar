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

## Canal de mensajería (Fase 4: Zavu + Telegram)

Se eligió **Telegram** porque es gratis y sin ventana de 24 h; WhatsApp por Zavu exige un número que no esté ya en WhatsApp (el plan Free no puede comprar números de Zavu) y plantillas aprobadas para avisar sin que escribas primero. El código es el mismo para ambos: cambiar a WhatsApp es `CHANNEL=zavu-whatsapp`.

1. **Bot:** en Telegram habla con [@BotFather](https://t.me/BotFather), `/newbot`, guarda el token.
2. **Zavu:** entra a https://dashboard.zavu.dev, crea tu proyecto y copia una API key (Settings → API Keys, `zv_live_…`; con `zv_test_…` solo envía a miembros de tu equipo). En tu **Sender → Channels → Add Telegram** pega el token, Verify y Save (Zavu registra el webhook con Telegram solo).
3. **URL pública:** Zavu necesita llegar a tu servidor. En local usa un túnel: `winget install Cloudflare.cloudflared` y `cloudflared tunnel --url http://localhost:3000` (sin cuenta; da una URL `https://….trycloudflare.com`). En la Fase 7 será la URL de Maritime.
4. **Webhook:** en el Sender → **Add Webhook**: URL `https://TU-URL/webhook/zavu`, eventos `message.inbound` y `conversation.new`. Copia el **secreto** que te muestra.
5. **.env** (el secreto es obligatorio: sin él no arranca, para que nadie falsifique mensajes):

```
CHANNEL=zavu-telegram
ZAVU_MODE=real
ZAVU_API_KEY=zv_…
ZAVU_WEBHOOK_SECRET=…
ALLOWED_SENDERS=          # vacío al principio
```

6. `pnpm dev`, escríbele "hola" a tu bot: te responde con **tu ID** (chat id). Ponlo en `ALLOWED_SENDERS`, reinicia y listo. Solo ese ID puede usar el agente (el bot de Telegram es público y cada pregunta gasta cuota de Tavily y del LLM).

Límites del plan Free de Zavu (doc del 2026-10-16): 2,000 mensajes/mes entre WhatsApp y Telegram (cuentan también los entrantes) y 250 conversacionales por día una vez verificada la cuenta (100/día sin verificar: se verifica con identidad o agregando un método de pago, "nothing is charged").

## Rutas

| Ruta | Qué hace |
| --- | --- |
| `GET /health` | Muestra qué integraciones están en mock y cuáles en real |
| `POST /ask` `{ text, usuario? }` | Conversa con el agente |
| `POST /match` `{ oportunidad, perfil? }` | Puntaje 0–100 y razones (servicio público para Qatom) |
| `GET /api/oportunidades?estado=&tipo=` | Lista para el panel |
| `GET /api/postulaciones`, `GET /api/estadisticas` | Datos para el panel |
| `POST /jobs/*` | Disparadores de n8n (requieren `Authorization: Bearer $JOBS_TOKEN`). Pendiente: Fase 6 |
| `POST /webhook/zavu` | Mensajes entrantes de Zavu (firma `X-Zavu-Signature` obligatoria). Contesta 200 al instante y responde en segundo plano |

## Estado

| Integración | Estado |
| --- | --- |
| LLM mock / Gemini / Groq | ✅ mock probado · Gemini y Groq implementados, falta probarlos con llave |
| SQLite (`node:sqlite`) | ✅ |
| AtomicMemory | ✅ real con Docker (probado: recuerda descartes tras reiniciar) · mock en RAM |
| Tavily | ✅ real probado con Gemini (búsqueda, plazos, sin duplicados) · mock sin llave |
| Apify | ✅ real probado con `apify/cheerio-scraper` en PRONABEC y OSIPTEL · mock sin llave |
| Zavu (Telegram / WhatsApp) | ✅ implementado y probado con tests sin red (firma, envío, dedupe, dueño único) · **falta probarlo con tu cuenta** (ver pasos arriba) |
| ElevenLabs | mock · real pendiente (Fase 5) |

## Pendiente

- Notas de voz y audios salientes por Zavu (Fase 5): la API de audio de Zavu pide una **URL pública HTTPS** del archivo, no bytes, y la doc no explica cómo bajar el audio de un mensaje entrante; hoy el bot responde que aún no entiende audios.
- WhatsApp con Zavu: sin probar (necesita número propio sin WhatsApp). Los avisos proactivos fuera de 24 h requerirían plantillas aprobadas.

- Tavily devuelve sobre todo portales agregadores (practicas.pe, Jobted…) y pocas ofertas individuales; la mayoría sale **sin plazo** (la página no lo trae en el resumen). Es un límite de la fuente, no se inventa la fecha.
- Los portales de Apify se leen con un `pageFunction` genérico (tarjetas con título + enlace, o tablas). Un portal con JavaScript pesado necesitaría otro actor (p. ej. Playwright).
- `enriquecer` (Tavily con `include_answer`) está implementado y con tests, pero aún no se probó con la llave real.

- AtomicMemory extrae los hechos en inglés y su búsqueda semántica en español es débil (modelo local pequeño); si no encuentra nada, se lee la memoria completa.
