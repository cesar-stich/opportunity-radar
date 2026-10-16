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

## Rutas

| Ruta | Qué hace |
| --- | --- |
| `GET /health` | Muestra qué integraciones están en mock y cuáles en real |
| `POST /ask` `{ text, usuario? }` | Conversa con el agente |
| `POST /match` `{ oportunidad, perfil? }` | Puntaje 0–100 y razones (servicio público para Qatom) |
| `GET /api/oportunidades?estado=&tipo=` | Lista para el panel |
| `GET /api/postulaciones`, `GET /api/estadisticas` | Datos para el panel |
| `POST /jobs/*` | Disparadores de n8n (requieren `Authorization: Bearer $JOBS_TOKEN`). Pendiente: Fase 6 |
| `POST /webhook/zavu` | Mensajes entrantes. Pendiente: Fase 4 |

## Estado

| Integración | Estado |
| --- | --- |
| LLM mock / Gemini / Groq | ✅ mock probado · Gemini y Groq implementados, falta probarlos con llave |
| SQLite (`node:sqlite`) | ✅ |
| AtomicMemory | mock (en RAM) · real pendiente (Fase 2, requiere Docker) |
| Tavily / Apify | mock · real pendiente (Fase 3) |
| Zavu | mock · real pendiente (Fase 4) |
| ElevenLabs | mock · real pendiente (Fase 5) |

## Pendiente

- Docker no está instalado: necesario para AtomicMemory (Fase 2) y para el despliegue (Fase 7).
