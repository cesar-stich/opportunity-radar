# Publicar `/match` en Qatom (pago por llamada)

Qatom vende APIs a agentes y personas: tú pones un endpoint HTTPS con precio por llamada y ellos lo descubren, pagan y lo usan.
Aquí se publica **solo `/match`**: recibe una oportunidad (y un perfil) y devuelve un puntaje 0–100 con razones. No toca tu base, tu memoria ni tu agente; es una función pura y barata (no gasta tokens ni créditos).

Fuentes (2026-10-16): https://www.qatom.ai/learn/charge-ai-agents-per-api-call, https://qatom.ai/llms.txt y https://docs.qatom.ai. **La documentación pública no detalla algunos puntos** (ver "Sin verificar"), por eso el endpoint acepta las dos formas posibles (POST con JSON o GET con query).

## Plan Free (según qatom.ai)

1 agente, hasta 5 ítems de catálogo, hasta 25 transacciones al mes, sin tarjeta. Solo necesitas 1 ítem.
Cobrar de verdad requiere conectar un método de cobro (Stripe, USDC…); **no lo actives** si te pide datos de pago: puedes publicar el ítem gratis (precio 0) para la demo.

## Pasos

1. **Servidor desplegado** (Fase 7) con `/match` accesible por internet. Genera un secreto y ponlo en el servidor:
   ```bash
   openssl rand -hex 24                       # copia el resultado
   maritime env set radar MATCH_TOKEN=<ese valor> --reload
   ```
   Con `MATCH_TOKEN` definido, `/match` responde **404** a cualquiera que no mande `Authorization: Bearer <MATCH_TOKEN>` (así lo recomienda Qatom). Sin él, `/match` queda abierto: úsalo solo en pruebas.
2. **Prueba el endpoint tú mismo** antes de tocar Qatom (un fallo se ve como "error de pago" genérico):
   ```bash
   curl -X POST https://TU-URL/match -H "content-type: application/json" -H "authorization: Bearer $MATCH_TOKEN" \
     -d '{"titulo":"Beca de IA","tipo":"beca","descripcion":"curso de inteligencia artificial","ubicacion":"Lima","intereses":"IA, cloud","busca":"becas","ubicacion_perfil":"Lima, Perú"}'
   ```
   Debe responder `{"puntaje":…,"razones":[…]}`.
3. **Cuenta:** entra a https://dashboard.m.todaq.net/ (dashboard de Qatom) y crea la cuenta Free.
4. **Crear ítem de catálogo** (name, receipt descriptor, price, method, endpoint, description, input schema, headers):
   - **Nombre:** `Radar Match — puntaje de oportunidades`
   - **Descripción:** *Dado un perfil de estudiante (intereses, qué busca, ciudad) y una oportunidad (práctica, beca, hackathon, convocatoria o curso), devuelve un puntaje 0–100 y las razones. Determinista y en español.*
   - **Precio:** `0.001` USD-TDN por llamada (mínimo; `0` lo deja gratis para la demo).
   - **Endpoint:** `https://TU-URL/match` — **sin secretos en la URL**.
   - **Método:** `POST`.
   - **Request headers & secret parameters:** `Authorization` = `Bearer <MATCH_TOKEN>` marcado como **Sensitive**.
   - **Input schema** (pégalo en el editor como está y pulsa Format):

```json
{
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["titulo", "tipo"],
    "properties": {
      "titulo": { "type": "string", "description": "Título de la oportunidad" },
      "tipo": { "type": "string", "enum": ["practica", "beca", "hackathon", "convocatoria", "curso"], "description": "Tipo de oportunidad" },
      "organizacion": { "type": "string", "description": "Organización que la ofrece" },
      "descripcion": { "type": "string", "description": "Descripción o requisitos" },
      "ubicacion": { "type": "string", "description": "Ciudad o lugar" },
      "modalidad": { "type": "string", "enum": ["presencial", "remoto", "hibrido"], "default": "presencial", "description": "Modalidad" },
      "plazo": { "type": "string", "description": "Fecha límite en formato YYYY-MM-DD" },
      "intereses": { "type": "string", "description": "Intereses del estudiante, separados por comas (ej. IA, cloud, datos)" },
      "busca": { "type": "string", "description": "Qué busca, separado por comas (ej. prácticas, becas, hackathones)" },
      "ubicacion_perfil": { "type": "string", "description": "Ciudad del estudiante (ej. Lima, Perú)" }
    }
  }
}
```

5. **Probar desde Qatom:** fondea una billetera pequeña de agente (o deja el precio en 0) y compra el ítem una vez con entradas válidas y otra con una inválida (`tipo: "otro"` debe dar `invalid_input`). Revisa que el recibo muestre el puntaje.
6. **Anunciar:** agrega el texto "llms.txt" / descripción que pide Qatom para que los asistentes lo encuentren (ver https://www.qatom.ai/learn/sell-to-ai-assistants).

## Cómo responde el servidor

- Éxito: `200 {"puntaje": 78, "razones": ["Es beca, algo que buscas", …], "transaction_id": "…"}` (devuelve también el header `X-Qatom-Transaction-Id` si Qatom lo manda).
- Error de entrada: `400 {"error": {"code": "invalid_input" | "unknown_parameter", "message": "…", "next_step": "…"}}`, como pide la guía de Qatom.
- Sin token correcto: `404`.
- Si no mandas perfil (`intereses`, `busca`, `ubicacion_perfil`), se usa el perfil del dueño del agente (útil para la demo; para clientes reales conviene exigirlos).

## Sin verificar (la doc no lo dice)

- Los valores permitidos del campo "método" del ítem y el **formato del cuerpo** que manda Qatom (JSON o query). `/match` acepta `POST` con JSON y `GET` con query; si tu ítem usa GET, cambia el método en el formulario.
- Si Qatom exige que la respuesta tenga una forma concreta (más allá de "tu respuesta vuelve en un recibo").
- Cómo se cobra y se retira el dinero (Stripe/USDC): no se probó ni se activó nada de pago.
- El ítem se creó **a mano en el dashboard**: no hay API de vendedor documentada públicamente que automatice esto.
