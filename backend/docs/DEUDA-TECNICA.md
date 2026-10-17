# Deuda técnica

Decisiones tomadas a conciencia para avanzar, que deben revisarse más adelante.
Cada ítem indica su origen, el riesgo de dejarlo así y la solución propuesta.
Cuando se aborde, se convierte en un spec.

| ID | Tema | Estado |
|---|---|---|
| TD-001 | Autenticación de la API más fuerte que la API key | Abierta |

## TD-001 — Autenticación de la API más fuerte que la API key

- **Registrada:** 2026-10-16 · **Origen:** spec 002 (antes tarea "evaluar JWT").
- **Decisión actual:** API key compartida en el header `x-api-key` (spec 001),
  guardada en Secrets Manager (spec 002).
- **Riesgo:** es un secreto compartido de larga duración. Si se filtra (logs,
  configuración del agente, repositorio), cualquiera puede usar la API hasta que
  se rote. No identifica qué consumidor hizo cada petición.
- **Mitigaciones actuales:** HTTPS, comparación en tiempo constante, rotación
  documentada, ningún pago se ejecuta sin la aprobación interactiva del dueño de
  la wallet.
- **Solución propuesta:** como el consumidor corre en Google Cloud, usar ID
  tokens OIDC de una service account de Google: JWT firmados por Google, de
  corta duración, verificados con las llaves públicas de Google y validando
  `aud`, `iss` y `exp`. Elimina el secreto compartido.
- **Por qué no ahora:** requiere configurar la service account y la audiencia
  en Google Cloud, y la verificación de tokens en la API; se prioriza tener el
  flujo de pagos funcionando.
