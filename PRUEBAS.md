# Lista de pruebas de Radar (de local a producción)

Todo el código está terminado y probado con mocks (83 tests). Esta lista es para **probarlo con servicios reales**, de menos a más riesgo.
Marca cada paso. Si uno falla, **no sigas**: pásale a Claude el paso, el comando y el error (sin llaves).

> **Para empezar una conversación nueva con Claude**, pega esto:
> *"Lee CLAUDE.md (sección 11) y PRUEBAS.md. Vamos a probar el proyecto paso a paso desde el paso N. Nunca imprimas el contenido de .env."*

## Presupuesto de cuota (para no gastar de más)

| Servicio | Gratis | Qué gasta cada prueba |
| --- | --- | --- |
| Tavily | 1,000 créditos/mes | 1 por búsqueda. `pnpm escanear` sin argumentos = 1 por cada fuente Tavily activa (3) |
| Apify | US$5/mes | una corrida corta por portal (~centavos) |
| Gemini | capa gratis | 1–3 llamadas por mensaje (a veces 503: reintenta o usa `LLM_PROVIDER=groq`) |
| AtomicMemory Cloud | 10,000 operaciones/mes | ingest = 3, search = 1 |
| Zavu | 2,000 mensajes/mes (incluye entrantes) | 1 por mensaje |
| ElevenLabs | 10,000 créditos/mes | ≈1 por carácter de audio (se acorta a ~900) |

---

## Fase A — Servidor local sin llaves (5 min)

- [ ] **A1.** `pnpm install` · `pnpm typecheck` · `pnpm test` → 83 tests en verde.
- [ ] **A2.** En `.env` deja todo en `mock` (`LLM_PROVIDER=mock`, `*_MODE=mock`, `CHANNEL=mock`). `pnpm seed` → "15 nuevas".
- [ ] **A3.** `pnpm dev` y en otra terminal `curl localhost:3000/health` → `"ok":true` con todo `mock`.
- [ ] **A4.** `curl -X POST localhost:3000/ask -H "content-type: application/json" -d '{"text":"que hay para practicas?"}'` → lista con puntajes. (En Windows las tildes en `-d` se rompen: usa palabras sin tilde o `--data-binary @archivo.json`.)

## Fase B — Servicios de IA, uno a uno (local, sin Telegram)

Cambia **un** interruptor por vez, reinicia (`pnpm dev`) y repite A4 o el comando indicado.

- [ ] **B1. Gemini:** `LLM_PROVIDER=gemini`, `LLM_MODEL=gemini-3.5-flash-lite`. `/health` dice `"llm":"gemini"` y `/ask` responde con tono natural usando herramientas. (Si da 503, `LLM_PROVIDER=groq`.)
- [ ] **B2. Memoria:** `MEMORY_MODE=real` (AtomicMemory Cloud). Pide "¿qué hay para prácticas?", luego "descarta la 3, no me interesa Lima Norte". Reinicia el servidor y vuelve a pedir: lo parecido a lo descartado debe bajar de puntaje y decir "Se parece a algo que descartaste".
- [ ] **B3. Tavily:** `TAVILY_MODE=real`. `pnpm escanear "practicas de telecomunicaciones en Lima"` (1 crédito) → lista con enlaces; repetirlo da "0 nuevas". Por chat: "busca prácticas de telecomunicaciones en Lima".
- [ ] **B4. Apify:** `APIFY_MODE=real`. Antes, para no gastar Tavily: `pnpm fuentes desactivar 1 2 3`. Luego `pnpm escanear` → trae PRONABEC y OSIPTEL. (Si da 403 "aprueba los permisos", abre el enlace que muestra el error.) Reactiva las fuentes después: `pnpm fuentes activar 1 2 3`.
- [ ] **B5. Enriquecer** (no se probó nunca con llave real): "investiga la 2" tras una búsqueda → resumen de la empresa (1 crédito).

## Fase C — Telegram por Zavu, en local

- [ ] **C1.** Zavu: API key (Settings → API Keys). En `.env`: `CHANNEL=zavu-telegram`, `ZAVU_MODE=real`, `ZAVU_API_KEY`, `ZAVU_SENDER_ID` (ID de **Radar bot**, el de la tabla de Senders; Radar bot debe ser el predeterminado).
- [ ] **C2.** Túnel: `winget install Cloudflare.cloudflared`, luego `cloudflared tunnel --url http://localhost:3000` → copia la URL `https://….trycloudflare.com`.
- [ ] **C3.** Zavu → Radar bot → **Add Webhook**: `https://LA-URL/webhook/zavu`, eventos `message.inbound` y `conversation.new`. Copia el **secreto** a `ZAVU_WEBHOOK_SECRET`.
- [ ] **C4.** `pnpm dev` (si no arranca, el mensaje dice qué variable falta). Escríbele "hola" a @radar_cesar_bot → responde con **tu ID**.
- [ ] **C5.** Pon ese número en `ALLOWED_SENDERS`, reinicia. Escribe "¿qué hay para prácticas?" → respuesta en Telegram (tarda unos segundos).
- [ ] **C6.** Conversación completa: "descarta la 3, no me interesa X" · "prepárame el mensaje para postular a la 1" (debe decir que **no** lo envió) · "busca becas de IA en Perú".
- [ ] **C7.** Seguridad: pídele a otra persona (o cuenta) que le escriba al bot → responde "Este agente es privado" y no gasta nada.

## Fase D — Avisos programados (con curl, antes de n8n)

Necesitan `JOBS_TOKEN` en `.env` y `ALLOWED_SENDERS` lleno.

- [ ] **D1.** `curl -X POST localhost:3000/jobs/resumen-semanal -H "authorization: Bearer TU_JOBS_TOKEN"` → te llega el resumen por Telegram.
- [ ] **D2.** `curl -X POST localhost:3000/jobs/escanear -H "authorization: Bearer …"` → avisa solo lo nuevo con puntaje ≥ `NOTIFY_MIN_SCORE` (70). Repetirlo no avisa lo mismo.
- [ ] **D3.** Marca algo que cierre en ≤ 3 días como "me interesa" y: `curl -X POST …/jobs/recordar-plazos …` → aviso una sola vez.
- [ ] **D4.** Tras un aviso responde "descarta la 2": debe referirse a la lista del aviso.

## Fase E — Voz (opcional)

- [ ] **E1.** ElevenLabs: API key y un `ELEVENLABS_VOICE_ID`. `.env`: `VOICE_MODE=real`, `REPLY_AS_VOICE=true`, `PUBLIC_URL=https://LA-URL-DEL-TUNEL`.
- [ ] **E2.** Manda una nota de voz al bot ("¿qué hay para becas?"). Esperado: te responde con audio. Si responde "No pude escuchar tu nota de voz", **mira la terminal**: el error dice si Zavu no trajo `mediaUrl` (es lo no verificado de la doc) y se corrige con lo que muestre.
- [ ] **E3.** Si el audio no llega pero sí el texto "🎙️ Te escuché: …": Telegram no aceptó el audio saliente por Zavu; es esperable y cae a texto.
- [ ] **E4.** `/jobs/resumen-semanal` con `REPLY_AS_VOICE=true` → texto + audio.

## Fase F — Producción (Maritime) — sigue [deploy/maritime.md](deploy/maritime.md)

- [ ] **F1.** Repo en GitHub (`git remote add origin …`, `git push -u origin main`). Verifica que `.env` **no** está en el repo.
- [ ] **F2.** `npm install -g maritime-cli`, cuenta, `maritime create radar --repo … --public --port 3000`, `maritime deploy … --wait`. (Si pide tarjeta: **no**; avisa.)
- [ ] **F3.** Crea `.env.prod` (no se sube a git) con las variables de la guía y `maritime env import radar ./.env.prod --reload`. Genera tokens largos: `openssl rand -hex 24` para `JOBS_TOKEN`, `API_TOKEN`, `PANEL_TOKEN`, `MATCH_TOKEN`.
- [ ] **F4.** `curl https://URL-DE-MARITIME/health` → ok. `maritime logs radar -f` en otra terminal mientras pruebas.
- [ ] **F5.** Cambia el webhook de Zavu a `https://URL-DE-MARITIME/webhook/zavu` y escríbele al bot (con tu laptop con el servidor **apagado**) → responde.
- [ ] **F6.** Dejas el bot 20+ minutos sin usar y vuelves a escribirle: debe despertar (~1–2 s extra). Si a veces no responde, anótalo: es el riesgo conocido del "sleep".

## Fase G — n8n

- [ ] **G1.** Cuenta en n8n (Cloud con prueba gratuita o self-hosted con Docker: `docker run -it --rm -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n`; **self-hosted no corre cuando apagas la laptop**, para el demo usa Cloud).
- [ ] **G2.** Importa los 3 JSON de `n8n/` (Workflows → Import from File). Si da error de formato, mándale a Claude el mensaje.
- [ ] **G3.** En cada nodo "POST /jobs/…" cambia `https://TU-URL-PUBLICA` por la URL de Maritime y `CAMBIA_ESTE_TOKEN` por tu `JOBS_TOKEN`.
- [ ] **G4.** Pulsa **Execute workflow** a mano en cada uno → debe responder `{ ok: true, … }` y llegarte el aviso.
- [ ] **G5.** **Publica** los 3 (si no, el cron no corre) y confirma la zona horaria `America/Lima` (8:00, 9:00 y domingos 19:00). Para una prueba rápida cambia un cron a "dentro de 5 minutos".

## Fase H — Panel (Lovable) — [dashboard/PROMPT.md](dashboard/PROMPT.md)

- [ ] **H1.** `curl https://URL/api/estadisticas -H "authorization: Bearer $PANEL_TOKEN"` → JSON.
- [ ] **H2.** En Lovable pega el prompt; define `VITE_API_URL` y `VITE_PANEL_TOKEN`.
- [ ] **H3.** El tablero muestra tus oportunidades; cambia una a "interesa" por el chat y comprueba que el panel la mueve (≤ 60 s). El token del panel **no** debe servir en `/ask` (da 401).

## Fase I — Qatom — [deploy/qatom.md](deploy/qatom.md)

- [ ] **I1.** `curl -X POST https://URL/match -H "authorization: Bearer $MATCH_TOKEN" -H "content-type: application/json" -d '{"titulo":"Beca de IA","tipo":"beca","intereses":"IA","busca":"becas"}'` → puntaje y razones; sin el Bearer → 404.
- [ ] **I2.** Crea el ítem en https://dashboard.m.todaq.net/ (precio 0 o 0.001, **no actives cobro real**), pega el esquema de la guía y compra una vez.
- [ ] **I3.** Anota qué **método y cuerpo** mandó Qatom (es lo no documentado) para que Claude actualice la guía.

---

## Si algo falla, mándale a Claude

1. El paso (ej. "C4") y qué esperabas vs qué pasó.
2. El error exacto de la terminal o de `maritime logs radar` (sin llaves: reemplázalas por `***`).
3. Una captura si es de un panel web (Zavu, n8n, Lovable, Qatom).

## Después de probar

Pídele a Claude que actualice la sección 11 de CLAUDE.md con lo que quedó verificado y lo que no, y que haga commit.
