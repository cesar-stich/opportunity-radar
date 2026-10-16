# Desplegar Radar en Maritime

Maritime solo **aloja** el servidor del agente (micro-VM con Docker). Zavu transporta y n8n dispara; los dos necesitan la URL pública que te da Maritime.
Doc consultada el 2026-10-16: https://maritime.sh/docs (CLI, `frameworks/custom`, `web-apps`, `triggers`, `limits`).

## Qué dice la doc que importa

- Se despliega desde un **repo de GitHub con Dockerfile** (`maritime create … --repo`). **No existe `git push maritime main`** (CLAUDE.md lo decía; corregido).
- `--public` da una URL pública **sin login**: por eso `/ask`, `/chat` y `/api/*` exigen `API_TOKEN` en producción, `/webhook/zavu` exige la firma de Zavu y `/jobs/*` exige `JOBS_TOKEN`.
- Solo `/data` persiste (reinicios, redeploys y sleep/wake). El Dockerfile ya usa `DB_PATH=/data/radar.db`.
- El agente **duerme** si no hay actividad y despierta en ~1 s con cualquier petición a su URL pública (webhook de Zavu, llamada de n8n). Los temporizadores internos no corren dormido, por eso el cron vive en n8n.
- Plan Free: 3 máquinas, 1 despierta a la vez, 2 GB RAM, 5 GB SSD (la doc no dice si pide tarjeta; si te la pide, **no la actives** y avísame).
- Contrato de contenedores propios: `GET /health` (2xx) y `POST /chat {message, source}` → `{response}`. Ambos existen.

## Pasos

1. **GitHub:** crea un repo (mejor privado) y sube el código. `.env` y `data/` están en `.gitignore`.
   ```bash
   git remote add origin https://github.com/TU-USUARIO/radar.git
   git push -u origin main
   ```
   Si Maritime no puede leer repos privados, hazlo público: no hay llaves en el código.
2. **CLI:** `npm install -g maritime-cli`, luego crea una cuenta/inicia sesión (`maritime whoami` para verificar). Token de automatización opcional: https://maritime.sh/developers.
3. **Crear y desplegar:**
   ```bash
   maritime create radar --repo https://github.com/TU-USUARIO/radar --branch main --public --port 3000
   maritime deploy radar --source github --repo https://github.com/TU-USUARIO/radar --branch main --wait
   ```
4. **Variables** (se guardan cifradas). Nunca las pegues en el chat; usa un archivo `.env.prod` local que **no** subas a git (cámbiale los valores):
   ```bash
   maritime env import radar ./.env.prod --reload
   maritime env list radar
   ```
   Mínimo en producción:
   ```
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=…
   LLM_MODEL=gemini-3.5-flash-lite
   MEMORY_MODE=real
   ATOMICMEMORY_URL=https://api.atomicstrata.ai
   ATOMICMEMORY_API_KEY=…
   TAVILY_MODE=real
   TAVILY_API_KEY=…
   APIFY_MODE=real
   APIFY_TOKEN=…
   CHANNEL=zavu-telegram
   ZAVU_MODE=real
   ZAVU_API_KEY=…
   ZAVU_SENDER_ID=…
   ZAVU_WEBHOOK_SECRET=…
   ALLOWED_SENDERS=TU_CHAT_ID
   JOBS_TOKEN=…largo y aleatorio…
   API_TOKEN=…largo y aleatorio…
   NOTIFY_MIN_SCORE=70
   ```
   No pongas `PORT` (Maritime lo inyecta) ni `DB_PATH` (el Dockerfile ya lo fija).
5. **Seed de fuentes** (primera vez): la base nace vacía en `/data`. Pídele al agente "busca…" o corre el seed dentro del contenedor si Maritime lo permite (`pnpm seed` crea las fuentes y 15 oportunidades de prueba; **omítelo** si no quieres datos ficticios).
6. **Estado y URL:** `maritime status radar`, `maritime info radar`, `maritime logs radar -f`. La URL pública sale en el panel de Maritime (la doc no fija su formato). Prueba:
   ```bash
   curl https://TU-URL/health
   ```

## Conectar Zavu y n8n a la URL pública

1. **Zavu:** Sender **Radar bot** → Add Webhook → `https://TU-URL/webhook/zavu`, eventos `message.inbound` y `conversation.new`. Copia el secreto a `ZAVU_WEBHOOK_SECRET` y recarga: `maritime env set radar ZAVU_WEBHOOK_SECRET=… --reload`.
2. Escríbele "hola" a @radar_cesar_bot: te responde con tu ID. Ponlo en `ALLOWED_SENDERS` (`maritime env set radar ALLOWED_SENDERS=… --reload`).
3. **n8n:** importa `n8n/*.json`, cambia `https://TU-URL-PUBLICA` por la URL de Maritime y `CAMBIA_ESTE_TOKEN` por tu `JOBS_TOKEN`, y publica cada workflow.
4. Prueba un job a mano: `curl -X POST https://TU-URL/jobs/resumen-semanal -H "authorization: Bearer $JOBS_TOKEN"`; debe llegarte un mensaje por Telegram.

## Riesgos conocidos

- **Dormir a media respuesta:** el webhook responde 200 y el agente sigue en segundo plano; la doc dice que el proceso se congela y reanuda, así que debería terminar, pero no está probado. Si ves respuestas que no llegan, revisa `maritime logs radar` y considera el add-on always-on.
- **1 máquina despierta a la vez en Free:** si algo excede el límite, Maritime responde 429 con reintento de 15 s; Zavu y n8n reintentan.
- La base SQLite vive en `/data`: haz copia si algo importa (`maritime` ofrece API de archivos; la doc no detalla backups).
